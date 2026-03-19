/*
 * ╔═══════════════════════════════════════╗
 * ║ Quality and Usability Lab / TU Berlin ║
 * ║ EchoStreamer (Sender)                 ║
 * ╚═══════════════════════════════════════╝
 */

#include "echostreamer.h"

static gboolean bus_call(GstBus *bus, GstMessage *msg, gpointer data)
{
    AppContext *context = (AppContext *)data;

    switch (GST_MESSAGE_TYPE(msg))
    {
    case GST_MESSAGE_EOS:
        g_print("End of stream\n");
        g_main_loop_quit(context->loop);
        break;

    case GST_MESSAGE_ERROR:
    {
        gchar *debug;
        GError *error;

        gst_message_parse_error(msg, &error, &debug);
        g_free(debug);

        g_printerr("Error: %s\n", error->message);
        g_error_free(error);

        g_main_loop_quit(context->loop);
        break;
    }

    case GST_MESSAGE_WARNING:
    {
        gchar *debug;
        GError *warning;

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

int run_sender(SenderParams *params)
{
    AppContext context;
    GstBus *bus;
    guint bus_watch_id;
    GstElement *alsasrc, *audioconvert, *audioresample, *capsfilter;
    GstElement *rtpL16pay, *tee;
    GstElement *queue1, *udpsink1; /* To peer */
    GstElement *queue2, *udpsink2; /* To localhost with threshold */
    GstElement *queue3, *udpsink3; /* To localhost for recording */
    GstCaps *caps;
    gint64 threshold_adjusted;

    /* Calculate adjusted threshold (matching bash script logic) */
    if (params->latency <= 20)
    {
        threshold_adjusted = 0;
    }
    else
    {
        threshold_adjusted = (params->latency - 20) * 1000000LL; /* Convert to nanoseconds */
    }

    g_print("Starting EchoStreamer in sender mode\n");
    g_print("  Platform: %s\n", get_platform_name());
    g_print("  Device: %s\n", params->device);
    g_print("  Peer IP: %s\n", params->peerip);
    g_print("  Latency: %d ms\n", params->latency);

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
    udpsink1 = gst_element_factory_make("udpsink", "udpsink-peer");

    /* Branch 2: To localhost with adjusted threshold */
    queue2 = gst_element_factory_make("queue", "queue-echo");
    udpsink2 = gst_element_factory_make("udpsink", "udpsink-echo");

    /* Branch 3: To localhost for recording */
    queue3 = gst_element_factory_make("queue", "queue-record");
    udpsink3 = gst_element_factory_make("udpsink", "udpsink-record");

    if (!context.pipeline || !alsasrc || !audioconvert || !audioresample ||
        !capsfilter || !rtpL16pay || !tee || !queue1 || !udpsink1 ||
        !queue2 || !udpsink2 || !queue3 || !udpsink3)
    {
        g_printerr("Not all elements could be created.\n");
        return 1;
    }

    /* Set element properties */
    configure_audio_source(alsasrc, params->device);
    g_object_set(G_OBJECT(rtpL16pay), "pt", 96, NULL);

    /* Queue 1: min-threshold-time = 0 */
    g_object_set(G_OBJECT(queue1), "min-threshold-time", (guint64)0, NULL);

    /* Queue 2: min-threshold-time = adjusted threshold */
    g_object_set(G_OBJECT(queue2), "min-threshold-time", (guint64)threshold_adjusted, NULL);

    /* Queue 3: min-threshold-time = 0 */
    g_object_set(G_OBJECT(queue3), "min-threshold-time", (guint64)0, NULL);

    /* UDP Sink 1: To peer */
    g_object_set(G_OBJECT(udpsink1),
                 "host", params->peerip,
                 "port", 9004,
                 "sync", FALSE,
                 NULL);

    /* UDP Sink 2: To localhost port 9005 (echo with delay) */
    g_object_set(G_OBJECT(udpsink2),
                 "host", "127.0.0.1",
                 "port", 9005,
                 "sync", FALSE,
                 NULL);

    /* UDP Sink 3: To localhost port 9006 (recording) */
    g_object_set(G_OBJECT(udpsink3),
                 "host", "127.0.0.1",
                 "port", 9006,
                 "sync", FALSE,
                 NULL);

    /* Set caps for audio format */
    caps = gst_caps_new_simple("audio/x-raw",
                               "channels", G_TYPE_INT, 1,
                               "rate", G_TYPE_INT, 48000,
                               NULL);
    g_object_set(G_OBJECT(capsfilter), "caps", caps, NULL);
    gst_caps_unref(caps);

    /* Add all elements to pipeline */
    gst_bin_add_many(GST_BIN(context.pipeline),
                     alsasrc, audioconvert, audioresample, capsfilter,
                     rtpL16pay, tee,
                     queue1, udpsink1,
                     queue2, udpsink2,
                     queue3, udpsink3,
                     NULL);

    /* Link main pipeline */
    if (!gst_element_link_many(alsasrc, audioconvert, audioresample,
                               capsfilter, rtpL16pay, tee, NULL))
    {
        g_printerr("Failed to link main pipeline elements.\n");
        gst_object_unref(context.pipeline);
        return 1;
    }

    /* Link branch 1 (to peer) */
    if (!gst_element_link_many(tee, queue1, udpsink1, NULL))
    {
        g_printerr("Failed to link branch 1 (peer).\n");
        gst_object_unref(context.pipeline);
        return 1;
    }

    /* Link branch 2 (echo with delay) */
    if (!gst_element_link_many(tee, queue2, udpsink2, NULL))
    {
        g_printerr("Failed to link branch 2 (echo).\n");
        gst_object_unref(context.pipeline);
        return 1;
    }

    /* Link branch 3 (recording) */
    if (!gst_element_link_many(tee, queue3, udpsink3, NULL))
    {
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
    if (ret == GST_STATE_CHANGE_FAILURE)
    {
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
