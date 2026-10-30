/*
 * EffectStreamer Core
 * @company Quality and Usability Lab | TU Berlin
 * @author  Eero Kaan <eerokaan@qu.tu-berlin.de>
 */

#include "effectstreamer.h"
#include "receiverstdin.h"
#include "lifecycle.h"
#include "recording/wav.h"
#include "device/webrtc.h"

typedef struct {
    GMutex lock;
    guint64 overruns;
    gint64 last_log_time;
} SpeakerQueueStats;

static void record_runtime_error(AppContext* context) {
    g_mutex_lock(&context->error_lock);
    context->runtime_error = TRUE;
    g_mutex_unlock(&context->error_lock);
}

static gboolean has_runtime_error(AppContext* context) {
    gboolean result;

    g_mutex_lock(&context->error_lock);
    result = context->runtime_error;
    g_mutex_unlock(&context->error_lock);

    return result;
}

static GstBusSyncReply bus_sync_call(GstBus* bus, GstMessage* msg, gpointer data) {
    AppContext* context = (AppContext*)data;
    (void)bus;

    if (GST_MESSAGE_TYPE(msg) == GST_MESSAGE_ERROR) record_runtime_error(context);
    return GST_BUS_PASS;
}

static void print_gstreamer_error(GstMessage* msg) {
    gchar* debug;
    GError* error;

    gst_message_parse_error(msg, &error, &debug);
    g_printerr("Error: %s\n", error->message);
    if (debug) g_printerr("GStreamer debug: %s\n", debug);

    g_free(debug);
    g_error_free(error);
}

static gboolean print_startup_errors(GstBus* bus) {
    GstMessage* msg;
    gboolean found = FALSE;

    while ((msg = gst_bus_pop_filtered(bus, GST_MESSAGE_ERROR)) != NULL) {
        print_gstreamer_error(msg);
        gst_message_unref(msg);
        found = TRUE;
    }
    return found;
}

static gboolean emit_ready(AppContext* context) {
    gboolean ready = FALSE;

    g_mutex_lock(&context->error_lock);
    if (!context->runtime_error) {
        g_printerr("EST_CORE_READY receiver\n");
        fflush(stderr);
        ready = TRUE;
    }
    g_mutex_unlock(&context->error_lock);

    return ready;
}

static gboolean bus_call(GstBus* bus, GstMessage* msg, gpointer data) {
    AppContext* context = (AppContext*)data;
    (void)bus;
    lifecycle_bus(context, msg);

    switch (GST_MESSAGE_TYPE(msg)) {
        case GST_MESSAGE_EOS:
            g_printerr("End of receiver stream\n");
            lifecycle_eos(context);
            break;

        case GST_MESSAGE_ERROR:
            print_gstreamer_error(msg);
            record_runtime_error(context);
            g_main_loop_quit(context->loop);
            break;

        case GST_MESSAGE_WARNING: {
            gchar* debug;
            GError* warning;

            gst_message_parse_warning(msg, &warning, &debug);
            g_printerr("Warning: %s\n", warning->message);
            if (debug) g_printerr("GStreamer debug: %s\n", debug);

            g_free(debug);
            g_error_free(warning);
            break;
        }

        default:
            break;
    }

    return TRUE;
}

static void speaker_queue_overrun(GstElement* queue, gpointer data) {
    SpeakerQueueStats* stats = (SpeakerQueueStats*)data;
    gint64 now = g_get_monotonic_time();
    (void)queue;

    // clang-format off
    g_mutex_lock(&stats->lock);
    stats->overruns++;
    if (stats->overruns == 1 || now - stats->last_log_time >= G_USEC_PER_SEC) {
        g_printerr("Warning: stdio speaker queue overrun dropped stale audio (%" G_GUINT64_FORMAT " overruns total).\n", stats->overruns);
        stats->last_log_time = now;
    }
    g_mutex_unlock(&stats->lock);
    // clang-format on
}

static guint64 get_speaker_queue_overruns(SpeakerQueueStats* stats) {
    guint64 result;

    g_mutex_lock(&stats->lock);
    result = stats->overruns;
    g_mutex_unlock(&stats->lock);

    return result;
}

int run_receiver(ReceiverParams* params) {
    AppContext context = {0};
    AudioBackend sink_backend;
    ReceiverStdinWatch* stdin_watch = NULL;
    SpeakerQueueStats speaker_stats = {0};

    GstBus* bus = NULL;
    guint bus_watch_id = 0;

    GstStateChangeReturn state_change;
    GstState current_state = GST_STATE_NULL;

    GstElement *udpsrc1, *rtpjitterbuffer1, *rtpL16depay1, *audioconvert1, *capsfilter1, *volume1;
    GstElement *udpsrc2, *rtpjitterbuffer2, *rtpL16depay2, *audioconvert2, *capsfilter2, *volume2;
    GstElement *adder, *tee, *queue_speaker;
    GstElement *audioconvert_speaker, *audioresample_speaker;

    GstCaps* caps_rtp = NULL;
    GstCaps* caps_audio = NULL;

    GstPad* adder_sink1 = NULL;
    GstPad* adder_sink2 = NULL;
    GstPad* src_pad = NULL;

    int result = 1;

    g_mutex_init(&context.error_lock);
    g_mutex_init(&speaker_stats.lock);

    g_printerr("Starting EffectStreamer in receiver mode\n");
    g_printerr("  Platform: %s\n", get_platform_name());
    g_printerr("  Backend: %s\n", get_device_type_name(params->device_type));
    if (params->device_id) g_printerr("  Device ID: %s\n", params->device_id);
    g_printerr("  Native Gain: %.2f\n", params->nativegain);
    g_printerr("  Echo Gain: %.2f\n", params->echogain);

    context.loop = g_main_loop_new(NULL, FALSE);
    context.pipeline = gst_pipeline_new("receiver-pipeline");

    // clang-format off
    if (!context.pipeline) {
        g_printerr("Error: Could not create the receiver pipeline.\n");
        goto cleanup;
    }
    if (!audio_backend_prepare(&context, &sink_backend, params->device_type, params->device_id, &params->webrtc, FALSE) || !add_audio_backend(GST_BIN(context.pipeline), &sink_backend)) {
        goto cleanup;
    }
    // clang-format on

    udpsrc1 = create_and_add_element(GST_BIN(context.pipeline), "udpsrc", "udpsrc-peer");
    rtpjitterbuffer1 = create_and_add_element(GST_BIN(context.pipeline), "rtpjitterbuffer", "jitterbuffer-peer");
    rtpL16depay1 = create_and_add_element(GST_BIN(context.pipeline), "rtpL16depay", "depay-peer");
    audioconvert1 = create_and_add_element(GST_BIN(context.pipeline), "audioconvert", "convert-peer");
    capsfilter1 = create_and_add_element(GST_BIN(context.pipeline), "capsfilter", "caps-peer");
    volume1 = create_and_add_element(GST_BIN(context.pipeline), "volume", "volume-peer");

    udpsrc2 = create_and_add_element(GST_BIN(context.pipeline), "udpsrc", "udpsrc-echo");
    rtpjitterbuffer2 = create_and_add_element(GST_BIN(context.pipeline), "rtpjitterbuffer", "jitterbuffer-echo");
    rtpL16depay2 = create_and_add_element(GST_BIN(context.pipeline), "rtpL16depay", "depay-echo");
    audioconvert2 = create_and_add_element(GST_BIN(context.pipeline), "audioconvert", "convert-echo");
    capsfilter2 = create_and_add_element(GST_BIN(context.pipeline), "capsfilter", "caps-echo");
    volume2 = create_and_add_element(GST_BIN(context.pipeline), "volume", "volume-echo");

    adder = create_and_add_element(GST_BIN(context.pipeline), "adder", "mixer");
    tee = create_and_add_element(GST_BIN(context.pipeline), "tee", "tee");
    queue_speaker = create_and_add_element(GST_BIN(context.pipeline), "queue", "queue-speaker");

    audioconvert_speaker = create_and_add_element(GST_BIN(context.pipeline), "audioconvert", "convert-speaker");
    audioresample_speaker = create_and_add_element(GST_BIN(context.pipeline), "audioresample", "resample-speaker");
    if (!udpsrc1 || !rtpjitterbuffer1 || !rtpL16depay1 || !audioconvert1 || !capsfilter1 || !volume1 || !udpsrc2 ||
        !rtpjitterbuffer2 || !rtpL16depay2 || !audioconvert2 || !capsfilter2 || !volume2 ||
        !adder || !tee || !queue_speaker || !audioconvert_speaker || !audioresample_speaker) {
        goto cleanup;
    }

    // clang-format off
    caps_rtp = gst_caps_new_simple(
        "application/x-rtp",
        "media", G_TYPE_STRING, "audio",
        "encoding-name", G_TYPE_STRING, "L16",
        "clock-rate", G_TYPE_INT, 48000,
        "channels", G_TYPE_INT, 1,
        "payload", G_TYPE_INT, 96,
        NULL
    );
    caps_audio = gst_caps_new_simple(
        "audio/x-raw",
        "channels", G_TYPE_INT, 1,
        "rate", G_TYPE_INT, 48000,
        NULL
    );
    // clang-format on

    g_object_set(G_OBJECT(udpsrc1), "port", params->listen_port, "address", params->bind_address, "reuse", FALSE, "caps", caps_rtp, NULL);
    g_object_set(G_OBJECT(rtpjitterbuffer1), "latency", 5, "drop-on-latency", TRUE, NULL);
    g_object_set(G_OBJECT(capsfilter1), "caps", caps_audio, NULL);
    g_object_set(G_OBJECT(volume1), "volume", params->nativegain, NULL);

    g_object_set(G_OBJECT(udpsrc2), "port", params->echo_port, "address", params->bind_address, "reuse", FALSE, "caps", caps_rtp, NULL);
    g_object_set(G_OBJECT(rtpjitterbuffer2), "latency", 5, "drop-on-latency", TRUE, NULL);
    g_object_set(G_OBJECT(capsfilter2), "caps", caps_audio, NULL);
    g_object_set(G_OBJECT(volume2), "volume", params->echogain, NULL);

    gst_caps_unref(caps_rtp);
    gst_caps_unref(caps_audio);

    // clang-format off
    if (params->device_type == DEVICE_TYPE_STDIO) {
        guint64 speaker_queue_time = gst_util_uint64_scale(4 * 128, GST_SECOND, 48000);
        g_object_set(G_OBJECT(queue_speaker), "max-size-buffers", (guint)0, "max-size-bytes", (guint)0, "max-size-time", speaker_queue_time, NULL);
        gst_util_set_object_arg(G_OBJECT(queue_speaker), "leaky", "downstream");
        g_signal_connect(queue_speaker, "overrun", G_CALLBACK(speaker_queue_overrun), &speaker_stats);
    }

    if (!gst_element_link_many(udpsrc1, rtpjitterbuffer1, rtpL16depay1, audioconvert1, capsfilter1, volume1, NULL)) {
        g_printerr("Error: Failed to link the peer input chain.\n");
        goto cleanup;
    }
    if (!gst_element_link_many(udpsrc2, rtpjitterbuffer2, rtpL16depay2, audioconvert2, capsfilter2, volume2, NULL)) {
        g_printerr("Error: Failed to link the echo input chain.\n");
        goto cleanup;
    }
    if (!gst_element_link(adder, tee)) {
        g_printerr("Error: Failed to link the receiver mixer.\n");
        goto cleanup;
    }
    if (!gst_element_link_many(tee, queue_speaker, audioconvert_speaker, audioresample_speaker, get_audio_backend_first(&sink_backend), NULL)) {
        g_printerr("Error: Failed to link the speaker output chain.\n");
        goto cleanup;
    }
    if (params->recording && !wav_recording_add(context.pipeline, tee, params->recording_dir, params->bind_address, params->record_port)) {
        goto cleanup;
    }
    // clang-format on

    src_pad = gst_element_get_static_pad(volume1, "src");
    adder_sink1 = gst_element_request_pad_simple(adder, "sink_%u");
    if (!src_pad || !adder_sink1 || gst_pad_link(src_pad, adder_sink1) != GST_PAD_LINK_OK) {
        g_printerr("Error: Failed to connect peer audio to the mixer.\n");
        if (src_pad) gst_object_unref(src_pad);
        goto cleanup;
    }
    gst_object_unref(src_pad);

    src_pad = gst_element_get_static_pad(volume2, "src");
    adder_sink2 = gst_element_request_pad_simple(adder, "sink_%u");
    if (!src_pad || !adder_sink2 || gst_pad_link(src_pad, adder_sink2) != GST_PAD_LINK_OK) {
        g_printerr("Error: Failed to connect echo audio to the mixer.\n");
        if (src_pad) gst_object_unref(src_pad);
        goto cleanup;
    }
    gst_object_unref(src_pad);

    bus = gst_pipeline_get_bus(GST_PIPELINE(context.pipeline));
    gst_bus_set_sync_handler(bus, bus_sync_call, &context, NULL);
    bus_watch_id = gst_bus_add_watch(bus, bus_call, &context);
    if (print_startup_errors(bus)) {
        record_runtime_error(&context);
        goto cleanup;
    }

    if (params->device_type == DEVICE_TYPE_WEBRTC && params->recording) {
        const char* names[] = {"wav-microphone", "wav-headphones"};
        for (guint i = 0; i < G_N_ELEMENTS(names); i++) {
            GstElement* sink = gst_bin_get_by_name(GST_BIN(context.pipeline), names[i]);
            audio_backend_watch_eos(&context, sink, "sink");gst_object_unref(sink);
        }
    }
    lifecycle_prepare(&context, params->managed, NULL, audioconvert_speaker);
    state_change = gst_element_set_state(context.pipeline, GST_STATE_PLAYING);
    if (state_change != GST_STATE_CHANGE_FAILURE && !params->managed) {
        state_change = gst_element_get_state(context.pipeline, &current_state, NULL, GST_CLOCK_TIME_NONE);
    }
    if (has_runtime_error(&context)) print_startup_errors(bus);
    if (state_change == GST_STATE_CHANGE_FAILURE || (!params->managed && current_state != GST_STATE_PLAYING) || has_runtime_error(&context)) {
        g_printerr("Error: Receiver pipeline failed during startup.\n");
        goto cleanup;
    }
    if (params->device_type == DEVICE_TYPE_STDIO) {
        stdin_watch = receiver_stdin_watch_start(&context);
        if (!stdin_watch) goto cleanup;
        if (receiver_stdin_watch_had_error(stdin_watch)) {
            g_printerr("Error: Receiver stdin watcher failed during startup.\n");
            goto cleanup;
        }
    }
    if (!params->managed && !emit_ready(&context)) {
        if (!print_startup_errors(bus)) g_printerr("Error: Receiver pipeline failed during startup.\n");
        goto cleanup;
    }

    if (params->managed) control_event(context.control, "control-ready", NULL);
    g_main_loop_run(context.loop);
    result = has_runtime_error(&context) || (stdin_watch && receiver_stdin_watch_had_error(stdin_watch)) ? 1 : 0;

cleanup:
    // Stop processing and collect the final runtime status
    audio_backend_quiesce(&context);
    if (stdin_watch) {
        if (receiver_stdin_watch_had_error(stdin_watch)) {
            result = 1;
        }
        receiver_stdin_watch_stop(stdin_watch);
    }
    if (context.pipeline) {
        gst_element_set_state(context.pipeline, GST_STATE_NULL);
    }
    if (has_runtime_error(&context)) {
        result = 1;
    }
    audio_backend_dispose(&context);
    lifecycle_finish(&context, result == 0, params->recording);
    if (params->device_type == DEVICE_TYPE_STDIO) {
        g_printerr("stdio speaker queue overruns: %" G_GUINT64_FORMAT "\n", get_speaker_queue_overruns(&speaker_stats));
    }

    // Remove bus handlers and release the bus
    if (bus_watch_id) {
        g_source_remove(bus_watch_id);
    }
    if (bus) {
        gst_bus_set_sync_handler(bus, NULL, NULL, NULL);
        gst_object_unref(bus);
    }

    // Release requested mixer pads
    if (adder_sink1) {
        gst_element_release_request_pad(adder, adder_sink1);
        gst_object_unref(adder_sink1);
    }
    if (adder_sink2) {
        gst_element_release_request_pad(adder, adder_sink2);
        gst_object_unref(adder_sink2);
    }

    // Release the pipeline and main loop
    if (context.pipeline) gst_object_unref(context.pipeline);
    if (context.loop) g_main_loop_unref(context.loop);

    // Free allocated resources, clear synchronization primitives and return
    g_mutex_clear(&speaker_stats.lock);
    g_mutex_clear(&context.error_lock);

    return result;
}
