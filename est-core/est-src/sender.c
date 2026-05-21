/*
 * EffectStreamer Core
 * @company Quality and Usability Lab | TU Berlin
 * @author  Eero Kaan <eerokaan@qu.tu-berlin.de>
 */

#include "effectstreamer.h"

static gboolean bus_call(GstBus* bus, GstMessage* msg, gpointer data) {
    AppContext* context = (AppContext*)data;

    switch (GST_MESSAGE_TYPE(msg)) {
        case GST_MESSAGE_EOS:
            g_print("End of stream\n");
            g_main_loop_quit(context->loop);
            break;

        case GST_MESSAGE_ERROR: {
            gchar* debug;
            GError* error;

            gst_message_parse_error(msg, &error, &debug);
            g_free(debug);

            g_printerr("Error: %s\n", error->message);
            g_error_free(error);

            g_main_loop_quit(context->loop);
            break;
        }

        case GST_MESSAGE_WARNING: {
            gchar* debug;
            GError* warning;

            gst_message_parse_warning(msg, &warning, &debug);
            g_free(debug);

            g_warning("Warning: %s\n", warning->message);
            g_error_free(warning);
            break;
        }

        default:
            break;
    }

    return TRUE;
}

int run_sender(SenderParams* params) {
    AppContext context;
    GstBus* bus;
    guint bus_watch_id;
    GstElement *alsasrc, *audioconvert, *audioresample, *capsfilter;
    GstElement *rtpL16pay, *tee;
    GstElement *queue1, *estnetsim1, *udpsink1;
    GstElement *queue2, *udpsink2;
    GstElement *queue3, *udpsink3;
    GstCaps* caps;
    gint64 nativedelay_adjusted;
    gint64 echodelay_adjusted;
    const char* packetloss_type;
    const char* packetloss_burst_model;
    gboolean packetloss_enabled;

    packetloss_type = params->packetloss_type != NULL ? params->packetloss_type : "none";
    packetloss_burst_model = params->packetloss_burst_model != NULL ? params->packetloss_burst_model : "g107-markov";
    packetloss_enabled = strcmp(packetloss_type, "none") != 0;

    /* Calculate adjusted thresholds */
    if (params->nativedelay <= 20) {
        nativedelay_adjusted = 0;
    } else {
        nativedelay_adjusted = (params->nativedelay - 20) * 1000000LL;
    }

    if (params->echodelay <= 20) {
        echodelay_adjusted = 0;
    } else {
        echodelay_adjusted = (params->echodelay - 20) * 1000000LL;
    }

    g_print("Starting EffectStreamer in sender mode\n");
    g_print("  Platform: %s\n", get_platform_name());
    g_print("  Device: %s\n", params->device);
    g_print("  Peer IP: %s\n", params->peerip);
    g_print("  Native Delay: %d ms\n", params->nativedelay);
    g_print("  Echo Delay: %d ms\n", params->echodelay);
    g_print("  Packet Loss Type: %s\n", packetloss_type);

    if (packetloss_enabled) {
        g_print("  Packet Loss Ratio: %.3f\n", params->packetloss_ratio);
        g_print("  Packet Loss Seed: %u\n", params->packetloss_seed);

        if (strcmp(packetloss_type, "bursty") == 0) {
            g_print("  Packet Loss Burst Model: %s\n", packetloss_burst_model);
            g_print("  Packet Loss Burst Ratio: %.3f\n", params->packetloss_burst_ratio);
        }
    }

    /* Create GStreamer elements */
    context.pipeline = gst_pipeline_new("sender-pipeline");
    alsasrc = gst_element_factory_make(AUDIO_SRC, "audio-source");
    audioconvert = gst_element_factory_make("audioconvert", "audio-convert");
    audioresample = gst_element_factory_make("audioresample", "audio-resample");
    capsfilter = gst_element_factory_make("capsfilter", "caps-filter");
    rtpL16pay = gst_element_factory_make("rtpL16pay", "rtp-payloader");
    tee = gst_element_factory_make("tee", "tee");

    /* Branch 1: To peer */
    queue1 = gst_element_factory_make("queue", "queue-peer");
    estnetsim1 = packetloss_enabled ? gst_element_factory_make("estnetsim", "netsim-peer") : NULL;
    udpsink1 = gst_element_factory_make("udpsink", "udpsink-peer");

    /* Branch 2: To localhost with adjusted threshold */
    queue2 = gst_element_factory_make("queue", "queue-echo");
    udpsink2 = gst_element_factory_make("udpsink", "udpsink-echo");

    /* Branch 3: To localhost for recording */
    queue3 = gst_element_factory_make("queue", "queue-record");
    udpsink3 = gst_element_factory_make("udpsink", "udpsink-record");

    if (packetloss_enabled && !estnetsim1) {
        g_printerr("Packet loss requested, but the estnetsim element could not be created. Check GST_PLUGIN_PATH.\n");
        return 1;
    }

    if (!context.pipeline || !alsasrc || !audioconvert || !audioresample || !capsfilter || !rtpL16pay || !tee || !queue1 || !udpsink1 || !queue2 || !udpsink2 ||
        !queue3 || !udpsink3) {
        g_printerr("Not all elements could be created.\n");
        return 1;
    }

    /* Set element properties */
    configure_audio_source(alsasrc, params->device);
    g_object_set(G_OBJECT(rtpL16pay), "pt", 96, NULL);

    /* Queue 1: Define buffer limits */
    g_object_set(G_OBJECT(queue1), "max-size-buffers", (guint64)0, "max-size-bytes", (guint64)0, "max-size-time", (guint64)0, "min-threshold-time",
                 (guint64)nativedelay_adjusted, NULL);

    /* Queue 2: Define buffer limits */
    g_object_set(G_OBJECT(queue2), "max-size-buffers", (guint64)0, "max-size-bytes", (guint64)0, "max-size-time", (guint64)0, "min-threshold-time",
                 (guint64)echodelay_adjusted, NULL);

    /* Queue 3: Define buffer limits */
    g_object_set(G_OBJECT(queue3), "max-size-buffers", (guint64)0, "max-size-bytes", (guint64)0, "max-size-time", (guint64)0, "min-threshold-time", (guint64)0,
                 NULL);

    /* UDP Sink 1: To peer */
    g_object_set(G_OBJECT(udpsink1), "host", params->peerip, "port", 9004, "sync", FALSE, NULL);

    if (packetloss_enabled) {
        gst_util_set_object_arg(G_OBJECT(estnetsim1), "packetloss-type", packetloss_type);
        gst_util_set_object_arg(G_OBJECT(estnetsim1), "packetloss-burst-model", packetloss_burst_model);
        g_object_set(G_OBJECT(estnetsim1), "packetloss-ratio", params->packetloss_ratio, "packetloss-seed", params->packetloss_seed, "packetloss-burst-ratio",
                     params->packetloss_burst_ratio, NULL);
    }

    /* UDP Sink 2: To localhost port 9005 (echo with delay) */
    g_object_set(G_OBJECT(udpsink2), "host", "127.0.0.1", "port", 9005, "sync", FALSE, NULL);

    /* UDP Sink 3: To localhost port 9006 (recording) */
    g_object_set(G_OBJECT(udpsink3), "host", "127.0.0.1", "port", 9006, "sync", FALSE, NULL);

    /* Set caps for audio format */
    caps = gst_caps_new_simple("audio/x-raw", "channels", G_TYPE_INT, 1, "rate", G_TYPE_INT, 48000, NULL);
    g_object_set(G_OBJECT(capsfilter), "caps", caps, NULL);
    gst_caps_unref(caps);

    /* Add all elements to pipeline */
    gst_bin_add_many(GST_BIN(context.pipeline), alsasrc, audioconvert, audioresample, capsfilter, rtpL16pay, tee, queue1, udpsink1, queue2, udpsink2, queue3,
                     udpsink3, NULL);

    if (packetloss_enabled) {
        gst_bin_add(GST_BIN(context.pipeline), estnetsim1);
    }

    /* Link main pipeline */
    if (!gst_element_link_many(alsasrc, audioconvert, audioresample, capsfilter, rtpL16pay, tee, NULL)) {
        g_printerr("Failed to link main pipeline elements.\n");
        gst_object_unref(context.pipeline);
        return 1;
    }

    /* Link branch 1 (to peer) */
    if (packetloss_enabled) {
        if (!gst_element_link_many(tee, queue1, estnetsim1, udpsink1, NULL)) {
            g_printerr("Failed to link branch 1 (peer with packet loss).\n");
            gst_object_unref(context.pipeline);
            return 1;
        }
    } else {
        if (!gst_element_link_many(tee, queue1, udpsink1, NULL)) {
            g_printerr("Failed to link branch 1 (peer).\n");
            gst_object_unref(context.pipeline);
            return 1;
        }
    }

    /* Link branch 2 (echo with delay) */
    if (!gst_element_link_many(tee, queue2, udpsink2, NULL)) {
        g_printerr("Failed to link branch 2 (echo).\n");
        gst_object_unref(context.pipeline);
        return 1;
    }

    /* Link branch 3 (recording) */
    if (!gst_element_link_many(tee, queue3, udpsink3, NULL)) {
        g_printerr("Failed to link branch 3 (record).\n");
        gst_object_unref(context.pipeline);
        return 1;
    }

    /* Add a message handler */
    bus = gst_pipeline_get_bus(GST_PIPELINE(context.pipeline));
    bus_watch_id = gst_bus_add_watch(bus, bus_call, &context);
    gst_object_unref(bus);

    /* Set the pipeline to playing state */
    g_print("Starting sender pipeline...\n");
    GstStateChangeReturn ret = gst_element_set_state(context.pipeline, GST_STATE_PLAYING);
    if (ret == GST_STATE_CHANGE_FAILURE) {
        g_printerr("Unable to set the pipeline to the playing state.\n");
        gst_object_unref(context.pipeline);
        return 1;
    }

    /* Create main loop and run */
    context.loop = g_main_loop_new(NULL, FALSE);
    g_print("Sender running. Press Ctrl+C to stop.\n");
    g_main_loop_run(context.loop);

    /* Cleanup */
    g_print("Stopping sender...\n");
    gst_element_set_state(context.pipeline, GST_STATE_NULL);
    gst_object_unref(context.pipeline);
    g_source_remove(bus_watch_id);
    g_main_loop_unref(context.loop);

    return 0;
}
