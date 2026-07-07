/*
 * EffectStreamer Core
 * @company Quality and Usability Lab | TU Berlin
 * @author  Eero Kaan <eerokaan@qu.tu-berlin.de>
 */

#include "effectstreamer.h"
#include "receiverstdin.h"

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

    switch (GST_MESSAGE_TYPE(msg)) {
        case GST_MESSAGE_EOS:
            g_printerr("End of receiver stream\n");
            g_main_loop_quit(context->loop);
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

static char* create_recording_directory(void) {
    char* recording_dir = g_build_filename(g_get_home_dir(), "effectstreamer", NULL);

    if (g_mkdir_with_parents(recording_dir, 0755) != 0) {
        g_printerr("Warning: Could not create recording directory %s\n", recording_dir);
    } else {
        g_printerr("Created recording directory: %s\n", recording_dir);
    }

    return recording_dir;
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
    GstElement *udpsrc3, *rtpjitterbuffer3, *rtpL16depay3, *audioconvert3;
    GstElement *opusenc_mic, *oggmux_mic, *filesink_mic;
    GstElement *adder, *tee, *queue_speaker, *queue_record;
    GstElement *audioconvert_speaker, *audioresample_speaker;
    GstElement *audioconvert_record, *audioresample_record, *opusenc_hp, *oggmux_hp, *filesink_hp;

    GstCaps* caps_rtp = NULL;
    GstCaps* caps_audio = NULL;

    GstPad* adder_sink1 = NULL;
    GstPad* adder_sink2 = NULL;
    GstPad* src_pad = NULL;

    char* recording_dir = NULL;
    char* record_file_microphone = NULL;
    char* record_file_headphones = NULL;
    int result = 1;

    g_mutex_init(&context.error_lock);
    g_mutex_init(&speaker_stats.lock);

    g_printerr("Starting EffectStreamer in receiver mode\n");
    g_printerr("  Platform: %s\n", get_platform_name());
    g_printerr("  Backend: %s\n", get_device_type_name(params->device_type));
    if (params->device_id) g_printerr("  Device ID: %s\n", params->device_id);
    g_printerr("  Native Gain: %.2f\n", params->nativegain);
    g_printerr("  Echo Gain: %.2f\n", params->echogain);

    recording_dir = create_recording_directory();
    record_file_microphone = g_strdup_printf("%s%cmicrophone.ogg", recording_dir, G_DIR_SEPARATOR);
    record_file_headphones = g_strdup_printf("%s%cheadphones.ogg", recording_dir, G_DIR_SEPARATOR);
    g_printerr("  Recording microphone to: %s\n", record_file_microphone);
    g_printerr("  Recording headphones to: %s\n", record_file_headphones);

    context.loop = g_main_loop_new(NULL, FALSE);
    context.pipeline = gst_pipeline_new("receiver-pipeline");

    // clang-format off
    if (!context.pipeline) {
        g_printerr("Error: Could not create the receiver pipeline.\n");
        goto cleanup;
    }
    if (!create_audio_sink(params->device_type, params->device_id, &sink_backend) || !add_audio_backend(GST_BIN(context.pipeline), &sink_backend)) {
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

    udpsrc3 = create_and_add_element(GST_BIN(context.pipeline), "udpsrc", "udpsrc-record");
    rtpjitterbuffer3 = create_and_add_element(GST_BIN(context.pipeline), "rtpjitterbuffer", "jitterbuffer-record");
    rtpL16depay3 = create_and_add_element(GST_BIN(context.pipeline), "rtpL16depay", "depay-record");
    audioconvert3 = create_and_add_element(GST_BIN(context.pipeline), "audioconvert", "convert-record");

    opusenc_mic = create_and_add_element(GST_BIN(context.pipeline), "opusenc", "opus-encoder-mic");
    oggmux_mic = create_and_add_element(GST_BIN(context.pipeline), "oggmux", "ogg-muxer-mic");
    filesink_mic = create_and_add_element(GST_BIN(context.pipeline), "filesink", "file-sink-mic");

    adder = create_and_add_element(GST_BIN(context.pipeline), "adder", "mixer");
    tee = create_and_add_element(GST_BIN(context.pipeline), "tee", "tee");
    queue_speaker = create_and_add_element(GST_BIN(context.pipeline), "queue", "queue-speaker");
    queue_record = create_and_add_element(GST_BIN(context.pipeline), "queue", "queue-record");

    audioconvert_speaker = create_and_add_element(GST_BIN(context.pipeline), "audioconvert", "convert-speaker");
    audioresample_speaker = create_and_add_element(GST_BIN(context.pipeline), "audioresample", "resample-speaker");
    audioconvert_record = create_and_add_element(GST_BIN(context.pipeline), "audioconvert", "convert-record-hp");
    audioresample_record = create_and_add_element(GST_BIN(context.pipeline), "audioresample", "resample-record-hp");

    opusenc_hp = create_and_add_element(GST_BIN(context.pipeline), "opusenc", "opus-encoder-hp");
    oggmux_hp = create_and_add_element(GST_BIN(context.pipeline), "oggmux", "ogg-muxer-hp");
    filesink_hp = create_and_add_element(GST_BIN(context.pipeline), "filesink", "file-sink-hp");

    if (!udpsrc1 || !rtpjitterbuffer1 || !rtpL16depay1 || !audioconvert1 || !capsfilter1 || !volume1 || !udpsrc2 ||
        !rtpjitterbuffer2 || !rtpL16depay2 || !audioconvert2 || !capsfilter2 || !volume2 || !udpsrc3 ||
        !rtpjitterbuffer3 || !rtpL16depay3 || !audioconvert3 || !opusenc_mic || !oggmux_mic || !filesink_mic ||
        !adder || !tee || !queue_speaker || !queue_record || !audioconvert_speaker || !audioresample_speaker ||
        !audioconvert_record || !audioresample_record || !opusenc_hp || !oggmux_hp || !filesink_hp) {
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

    g_object_set(G_OBJECT(udpsrc1), "port", 9004, "caps", caps_rtp, NULL);
    g_object_set(G_OBJECT(rtpjitterbuffer1), "latency", 5, "drop-on-latency", TRUE, NULL);
    g_object_set(G_OBJECT(capsfilter1), "caps", caps_audio, NULL);
    g_object_set(G_OBJECT(volume1), "volume", params->nativegain, NULL);

    g_object_set(G_OBJECT(udpsrc2), "port", 9005, "caps", caps_rtp, NULL);
    g_object_set(G_OBJECT(rtpjitterbuffer2), "latency", 5, "drop-on-latency", TRUE, NULL);
    g_object_set(G_OBJECT(capsfilter2), "caps", caps_audio, NULL);
    g_object_set(G_OBJECT(volume2), "volume", params->echogain, NULL);

    g_object_set(G_OBJECT(udpsrc3), "port", 9006, "caps", caps_rtp, NULL);
    g_object_set(G_OBJECT(rtpjitterbuffer3), "latency", 5, "drop-on-latency", TRUE, NULL);

    gst_caps_unref(caps_rtp);
    gst_caps_unref(caps_audio);

    g_object_set(G_OBJECT(opusenc_mic), "bitrate", 128000, NULL);
    g_object_set(G_OBJECT(filesink_mic), "location", record_file_microphone, "sync", FALSE, "async", FALSE, NULL);

    g_object_set(G_OBJECT(opusenc_hp), "bitrate", 128000, NULL);
    g_object_set(G_OBJECT(filesink_hp), "location", record_file_headphones, "sync", FALSE, "async", FALSE, NULL);

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
    if (!gst_element_link_many(udpsrc3, rtpjitterbuffer3, rtpL16depay3, audioconvert3, opusenc_mic, oggmux_mic, filesink_mic, NULL)) {
        g_printerr("Error: Failed to link the microphone recording chain.\n");
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
    if (!gst_element_link_many(tee, queue_record, audioconvert_record, audioresample_record, opusenc_hp, oggmux_hp, filesink_hp, NULL)) {
        g_printerr("Error: Failed to link the headphones recording chain.\n");
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

    state_change = gst_element_set_state(context.pipeline, GST_STATE_PLAYING);
    if (state_change != GST_STATE_CHANGE_FAILURE) {
        state_change = gst_element_get_state(context.pipeline, &current_state, NULL, GST_CLOCK_TIME_NONE);
    }
    if (print_startup_errors(bus)) {
        record_runtime_error(&context);
    }
    if (state_change == GST_STATE_CHANGE_FAILURE || current_state != GST_STATE_PLAYING || has_runtime_error(&context)) {
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
    if (!emit_ready(&context)) {
        if (!print_startup_errors(bus)) g_printerr("Error: Receiver pipeline failed during startup.\n");
        goto cleanup;
    }

    g_main_loop_run(context.loop);
    result = has_runtime_error(&context) || (stdin_watch && receiver_stdin_watch_had_error(stdin_watch)) ? 1 : 0;

cleanup:
    // Stop processing and collect the final runtime status
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
    g_free(recording_dir);
    g_free(record_file_microphone);
    g_free(record_file_headphones);
    g_mutex_clear(&speaker_stats.lock);
    g_mutex_clear(&context.error_lock);

    return result;
}
