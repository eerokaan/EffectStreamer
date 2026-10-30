/*
 * EffectStreamer Core
 * @company Quality and Usability Lab | TU Berlin
 * @author  Eero Kaan <eerokaan@qu.tu-berlin.de>
 */

#include "effectstreamer.h"
#include "lifecycle.h"
#include "device/webrtc.h"

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
        g_printerr("EST_CORE_READY sender\n");
        fflush(stderr);
        ready = TRUE;
    }
    g_mutex_unlock(&context->error_lock);

    return ready;
}

static gboolean is_packetloss_enabled(const char* packetloss_type) {
    return strcmp(packetloss_type, "none") != 0;
}
static GstPadProbeReturn preparation_silence(GstPad* pad, GstPadProbeInfo* info, gpointer data) {
    (void)pad;AppContext* context = data;
    if (!g_atomic_int_get(&context->started)) {
        // Muting the upstream volume alone cannot retract a buffer already
        // between conversion and the valve when the main thread primes it.
        GstBuffer* buffer = gst_buffer_make_writable(GST_PAD_PROBE_INFO_BUFFER(info));
        GST_PAD_PROBE_INFO_DATA(info) = buffer;
        gst_buffer_memset(buffer, 0, 0, gst_buffer_get_size(buffer));
    }
    return GST_PAD_PROBE_OK;
}

static gboolean bus_call(GstBus* bus, GstMessage* msg, gpointer data) {
    AppContext* context = (AppContext*)data;
    (void)bus;
    lifecycle_bus(context, msg);

    switch (GST_MESSAGE_TYPE(msg)) {
        case GST_MESSAGE_EOS:
            g_printerr("End of sender stream\n");
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

int run_sender(SenderParams* params) {
    AppContext context = {0};
    AudioBackend source_backend;

    GstBus* bus = NULL;
    guint bus_watch_id = 0;

    GstStateChangeReturn state_change;
    GstState current_state = GST_STATE_NULL;

    GstElement *audioconvert, *audioresample, *capsfilter;
    GstElement *rtpL16pay, *tee, *gate, *packetizer, *pacer = NULL;
    GstElement *queue1, *estnetsim1, *udpsink1;
    GstElement *queue2, *udpsink2;
    GstElement *queue3, *udpsink3;

    GstCaps* caps;

    guint64 nativedelay;
    guint64 echodelay;

    const char* packetloss_type;
    const char* packetloss_burst_model;
    int result = 1;

    g_mutex_init(&context.error_lock);

    packetloss_type = params->packetloss_type;
    packetloss_burst_model = params->packetloss_burst_model;
    nativedelay = (guint64)params->nativedelay * GST_MSECOND;
    echodelay = (guint64)params->echodelay * GST_MSECOND;

    g_printerr("Starting EffectStreamer in sender mode\n");
    g_printerr("  Platform: %s\n", get_platform_name());
    g_printerr("  Backend: %s\n", get_device_type_name(params->device_type));
    if (params->device_id) g_printerr("  Device ID: %s\n", params->device_id);
    g_printerr("  Peer IP: %s\n", params->peerip);
    g_printerr("  Additional Native Delay: %d ms\n", params->nativedelay);
    g_printerr("  Additional Echo Delay: %d ms\n", params->echodelay);
    g_printerr("  Packet Loss Type: %s\n", packetloss_type);

    if (is_packetloss_enabled(packetloss_type)) {
        g_printerr("  Packet Loss Ratio: %.3f\n", params->packetloss_ratio);
        g_printerr("  Packet Loss Seed: %u\n", params->packetloss_seed);

        if (strcmp(packetloss_type, "bursty") == 0) {
            g_printerr("  Packet Loss Burst Model: %s\n", packetloss_burst_model);
            g_printerr("  Packet Loss Burst Ratio: %.3f\n", params->packetloss_burst_ratio);
        }
    }

    context.loop = g_main_loop_new(NULL, FALSE);
    context.pipeline = gst_pipeline_new("sender-pipeline");

    // clang-format off
    if (!context.pipeline) {
        g_printerr("Error: Could not create the sender pipeline.\n");
        goto cleanup;
    }
    if (!audio_backend_prepare(&context, &source_backend, params->device_type, params->device_id, &params->webrtc, TRUE) || !add_audio_backend(GST_BIN(context.pipeline), &source_backend)) {
        goto cleanup;
    }
    // clang-format on

    audioconvert = create_and_add_element(GST_BIN(context.pipeline), "audioconvert", "audio-convert");
    audioresample = create_and_add_element(GST_BIN(context.pipeline), "audioresample", "audio-resample");
    capsfilter = create_and_add_element(GST_BIN(context.pipeline), "capsfilter", "caps-filter");
    rtpL16pay = create_and_add_element(GST_BIN(context.pipeline), "rtpL16pay", "rtp-payloader");
    tee = create_and_add_element(GST_BIN(context.pipeline), "tee", "tee");
    gate = create_and_add_element(GST_BIN(context.pipeline), "valve", "audio-gate");
    context.preparation_volume = create_and_add_element(GST_BIN(context.pipeline), "volume", "preparation-mute");
    packetizer = create_and_add_element(GST_BIN(context.pipeline), "audiobuffersplit", "rtp-frame-split");
    if (params->device_type == DEVICE_TYPE_WEBRTC) pacer = create_and_add_element(GST_BIN(context.pipeline), "identity", "rtp-frame-pacer");

    // clang-format off
    queue1 = create_and_add_element(GST_BIN(context.pipeline), "queue", "queue-peer");
    estnetsim1 = is_packetloss_enabled(packetloss_type) ? create_and_add_element(GST_BIN(context.pipeline), "estnetsim", "netsim-peer") : NULL;
    udpsink1 = create_and_add_element(GST_BIN(context.pipeline), "udpsink", "udpsink-peer");
    // clang-format on

    queue2 = create_and_add_element(GST_BIN(context.pipeline), "queue", "queue-echo");
    udpsink2 = create_and_add_element(GST_BIN(context.pipeline), "udpsink", "udpsink-echo");

    queue3 = params->recording ? create_and_add_element(GST_BIN(context.pipeline), "queue", "queue-record") : NULL;
    udpsink3 = params->recording ? create_and_add_element(GST_BIN(context.pipeline), "udpsink", "udpsink-record") : NULL;

    if (!audioconvert || !audioresample || !capsfilter || !rtpL16pay || !tee || !gate || !context.preparation_volume || !packetizer || !queue1 ||
        (params->device_type == DEVICE_TYPE_WEBRTC && !pacer) || (is_packetloss_enabled(packetloss_type) && !estnetsim1) || !udpsink1 || !queue2 || !udpsink2 || (params->recording && (!queue3 || !udpsink3))) {
        goto cleanup;
    }

    // clang-format off
    g_object_set(G_OBJECT(rtpL16pay), "pt", 96, NULL);
    g_object_set(packetizer, "output-buffer-size", (guint)(params->rtp_frames * 2), "strict-buffer-size", FALSE, NULL);
    // Decoded Opus arrives in multi-packet blocks. Clock each split PCM buffer
    // before the impairment branches instead of bursting a whole block into
    // their small RTP jitterbuffers. Do not clock after the configured delays.
    if (pacer) g_object_set(pacer, "sync", TRUE, NULL);
    g_object_set(G_OBJECT(queue1), "max-size-buffers", (guint)0, "max-size-bytes", (guint)0, "max-size-time", (guint64)0, "min-threshold-time", nativedelay, NULL);
    g_object_set(G_OBJECT(queue2), "max-size-buffers", (guint)0, "max-size-bytes", (guint)0, "max-size-time", (guint64)0, "min-threshold-time", echodelay, NULL);
    if (queue3) g_object_set(G_OBJECT(queue3), "max-size-buffers", (guint)0, "max-size-bytes", (guint)0, "max-size-time", (guint64)0, "min-threshold-time", (guint64)0, NULL);
    g_object_set(G_OBJECT(udpsink1), "host", params->peerip, "port", params->peer_port, "sync", FALSE, NULL);
    g_object_set(G_OBJECT(udpsink2), "host", "127.0.0.1", "port", params->echo_port, "sync", FALSE, NULL);
    if (udpsink3) g_object_set(G_OBJECT(udpsink3), "host", "127.0.0.1", "port", params->record_port, "sync", FALSE, NULL);
    
    if (is_packetloss_enabled(packetloss_type)) {
        gst_util_set_object_arg(G_OBJECT(estnetsim1), "packetloss-type", packetloss_type);
        gst_util_set_object_arg(G_OBJECT(estnetsim1), "packetloss-burst-model", packetloss_burst_model);
        g_object_set(G_OBJECT(estnetsim1), "packetloss-ratio", params->packetloss_ratio, "packetloss-seed", params->packetloss_seed, "packetloss-burst-ratio", params->packetloss_burst_ratio, NULL);
    }

    caps = gst_caps_new_simple(
        "audio/x-raw",
        "format", G_TYPE_STRING, "S16BE",
        "channels", G_TYPE_INT, 1,
        "rate", G_TYPE_INT, 48000,
        NULL
    );
    // clang-format on

    g_object_set(G_OBJECT(capsfilter), "caps", caps, NULL);
    gst_caps_unref(caps);

    // clang-format off
    if (!gst_element_link_many(get_audio_backend_last(&source_backend), context.preparation_volume, audioconvert, audioresample, capsfilter, gate, packetizer, NULL) ||
        !(pacer ? gst_element_link_many(packetizer, pacer, rtpL16pay, tee, NULL) : gst_element_link_many(packetizer, rtpL16pay, tee, NULL))) {
        g_printerr("Error: Failed to link the sender audio source chain.\n");
        goto cleanup;
    }
    // clang-format on

    if (is_packetloss_enabled(packetloss_type)) {
        if (!gst_element_link_many(tee, queue1, estnetsim1, udpsink1, NULL)) {
            g_printerr("Error: Failed to link the peer branch with packet loss.\n");
            goto cleanup;
        }
    } else if (!gst_element_link_many(tee, queue1, udpsink1, NULL)) {
        g_printerr("Error: Failed to link the peer branch.\n");
        goto cleanup;
    }

    if (!gst_element_link_many(tee, queue2, udpsink2, NULL)) {
        g_printerr("Error: Failed to link the echo branch.\n");
        goto cleanup;
    }
    if (params->recording && !gst_element_link_many(tee, queue3, udpsink3, NULL)) {
        g_printerr("Error: Failed to link the recording branch.\n");
        goto cleanup;
    }

    bus = gst_pipeline_get_bus(GST_PIPELINE(context.pipeline));
    gst_bus_set_sync_handler(bus, bus_sync_call, &context, NULL);
    bus_watch_id = gst_bus_add_watch(bus, bus_call, &context);
    if (print_startup_errors(bus)) {
        record_runtime_error(&context);
        goto cleanup;
    }

    if (params->device_type == DEVICE_TYPE_WEBRTC) {
        GstPad* pcm = gst_element_get_static_pad(packetizer, "src");
        gst_pad_add_probe(pcm, GST_PAD_PROBE_TYPE_BUFFER, preparation_silence, &context, NULL);gst_object_unref(pcm);
        audio_backend_watch_eos(&context, udpsink1, "sink");audio_backend_watch_eos(&context, udpsink2, "sink");
        if (udpsink3) audio_backend_watch_eos(&context, udpsink3, "sink");
    }
    lifecycle_prepare(&context, params->managed, gate, capsfilter);
    state_change = gst_element_set_state(context.pipeline, GST_STATE_PLAYING);
    if (state_change != GST_STATE_CHANGE_FAILURE && !params->managed) {
        state_change = gst_element_get_state(context.pipeline, &current_state, NULL, GST_CLOCK_TIME_NONE);
    }
    // pop_filtered discards nonmatching messages, including an early EOS.
    // The sync bus handler already records errors; drain only on failure.
    if (has_runtime_error(&context)) print_startup_errors(bus);
    if (state_change == GST_STATE_CHANGE_FAILURE || (!params->managed && current_state != GST_STATE_PLAYING) || has_runtime_error(&context)) {
        g_printerr("Error: Sender pipeline failed during startup.\n");
        goto cleanup;
    }
    if (!params->managed && !emit_ready(&context)) {
        if (!print_startup_errors(bus)) g_printerr("Error: Sender pipeline failed during startup.\n");
        goto cleanup;
    }

    if (params->managed) control_event(context.control, "control-ready", NULL);
    g_main_loop_run(context.loop);
    result = has_runtime_error(&context) ? 1 : 0;

cleanup:
    // Stop processing and collect the final runtime status
    audio_backend_quiesce(&context);
    if (context.pipeline) {
        gst_element_set_state(context.pipeline, GST_STATE_NULL);
    }
    if (has_runtime_error(&context)) {
        result = 1;
    }
    audio_backend_dispose(&context);
    lifecycle_finish(&context, result == 0, FALSE);
    if (bus_watch_id) {
        g_source_remove(bus_watch_id);
    }
    if (bus) {
        gst_bus_set_sync_handler(bus, NULL, NULL, NULL);
        gst_object_unref(bus);
    }

    // Release the pipeline and main loop
    if (context.pipeline) gst_object_unref(context.pipeline);
    if (context.loop) g_main_loop_unref(context.loop);

    // Free allocated resources, clear synchronization primitives and return
    g_mutex_clear(&context.error_lock);

    return result;
}
