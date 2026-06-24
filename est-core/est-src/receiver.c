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

static char* create_recording_directory(void) {
    char* recording_dir;
    recording_dir = g_build_filename(g_get_home_dir(), "effectstreamer", NULL);

    if (g_mkdir_with_parents(recording_dir, 0755) != 0) {
        g_printerr("Warning: Could not create recording directory %s\n", recording_dir);
    } else {
        g_print("Created recording directory: %s\n", recording_dir);
    }

    return recording_dir;
}

int run_receiver(ReceiverParams* params) {
    AppContext context;
    GstBus* bus;
    guint bus_watch_id;

    /* Elements for source 1 (peer audio) */
    GstElement *udpsrc1, *rtpjitterbuffer1, *rtpL16depay1, *audioconvert1, *capsfilter1, *volume1;

    /* Elements for source 2 (echo) */
    GstElement *udpsrc2, *rtpjitterbuffer2, *rtpL16depay2, *audioconvert2, *capsfilter2, *volume2;

    /* Elements for source 3 (microphone recording) */
    GstElement *udpsrc3, *rtpjitterbuffer3, *rtpL16depay3, *audioconvert3;
    GstElement *opusenc_mic, *oggmux_mic, *filesink_mic;

    /* Common elements */
    GstElement *adder, *tee, *queue_speaker, *queue_record;
    GstElement *audioconvert_speaker, *audioresample_speaker, *alsasink;
    GstElement *audioconvert_record, *audioresample_record, *opusenc_hp, *oggmux_hp, *filesink_hp;

    GstCaps *caps_rtp, *caps_audio;
    GstPad *adder_sink1, *adder_sink2, *src_pad1, *src_pad2;
    char* recording_dir;
    char* record_file_microphone;
    char* record_file_headphones;

    g_print("Starting EffectStreamer in receiver mode\n");
    g_print("  Platform: %s\n", get_platform_name());
    g_print("  Device: %s\n", params->device);
    g_print("  Native Gain: %.2f\n", params->nativegain);
    g_print("  Echo Gain: %.2f\n", params->echogain);

    /* Create recording directory */
    recording_dir = create_recording_directory();
    record_file_microphone = g_strdup_printf("%s%cmicrophone.ogg", recording_dir, G_DIR_SEPARATOR);
    record_file_headphones = g_strdup_printf("%s%cheadphones.ogg", recording_dir, G_DIR_SEPARATOR);
    g_print("  Recording microphone to: %s\n", record_file_microphone);
    g_print("  Recording headphones to: %s\n", record_file_headphones);

    /* Create GStreamer elements */
    context.pipeline = gst_pipeline_new("receiver-pipeline");

    /* Source 1: Peer audio on port 9004 */
    udpsrc1 = gst_element_factory_make("udpsrc", "udpsrc-peer");
    rtpjitterbuffer1 = gst_element_factory_make("rtpjitterbuffer", "jitterbuffer-peer");
    rtpL16depay1 = gst_element_factory_make("rtpL16depay", "depay-peer");
    audioconvert1 = gst_element_factory_make("audioconvert", "convert-peer");
    capsfilter1 = gst_element_factory_make("capsfilter", "caps-peer");
    volume1 = gst_element_factory_make("volume", "volume-peer");

    /* Source 2: Echo audio on port 9005 */
    udpsrc2 = gst_element_factory_make("udpsrc", "udpsrc-echo");
    rtpjitterbuffer2 = gst_element_factory_make("rtpjitterbuffer", "jitterbuffer-echo");
    rtpL16depay2 = gst_element_factory_make("rtpL16depay", "depay-echo");
    audioconvert2 = gst_element_factory_make("audioconvert", "convert-echo");
    capsfilter2 = gst_element_factory_make("capsfilter", "caps-echo");
    volume2 = gst_element_factory_make("volume", "volume-echo");

    /* Source 3: Microphone recording audio on port 9006 */
    udpsrc3 = gst_element_factory_make("udpsrc", "udpsrc-record");
    rtpjitterbuffer3 = gst_element_factory_make("rtpjitterbuffer", "jitterbuffer-record");
    rtpL16depay3 = gst_element_factory_make("rtpL16depay", "depay-record");
    audioconvert3 = gst_element_factory_make("audioconvert", "convert-record");
    opusenc_mic = gst_element_factory_make("opusenc", "opus-encoder-mic");
    oggmux_mic = gst_element_factory_make("oggmux", "ogg-muxer-mic");
    filesink_mic = gst_element_factory_make("filesink", "file-sink-mic");

    /* Common output elements */
    adder = gst_element_factory_make("adder", "mixer");
    tee = gst_element_factory_make("tee", "tee");
    queue_speaker = gst_element_factory_make("queue", "queue-speaker");
    queue_record = gst_element_factory_make("queue", "queue-record");
    audioconvert_speaker = gst_element_factory_make("audioconvert", "convert-speaker");
    audioresample_speaker = gst_element_factory_make("audioresample", "resample-speaker");
    alsasink = gst_element_factory_make(AUDIO_SINK, "audio-output");
    audioconvert_record = gst_element_factory_make("audioconvert", "convert-record-hp");
    audioresample_record = gst_element_factory_make("audioresample", "resample-record-hp");
    opusenc_hp = gst_element_factory_make("opusenc", "opus-encoder-hp");
    oggmux_hp = gst_element_factory_make("oggmux", "ogg-muxer-hp");
    filesink_hp = gst_element_factory_make("filesink", "file-sink-hp");

    if (!context.pipeline || !udpsrc1 || !rtpjitterbuffer1 || !rtpL16depay1 || !audioconvert1 || !capsfilter1 || !volume1 || !udpsrc2 || !rtpjitterbuffer2 ||
        !rtpL16depay2 || !audioconvert2 || !capsfilter2 || !volume2 || !udpsrc3 || !rtpjitterbuffer3 || !rtpL16depay3 || !audioconvert3 || !opusenc_mic ||
        !oggmux_mic || !filesink_mic || !adder || !tee || !queue_speaker || !queue_record || !audioconvert_speaker || !audioresample_speaker || !alsasink ||
        !audioconvert_record || !audioresample_record || !opusenc_hp || !oggmux_hp || !filesink_hp) {
        g_printerr("Not all elements could be created.\n");
        g_free(recording_dir);
        g_free(record_file_microphone);
        g_free(record_file_headphones);
        return 1;
    }

    /* Set RTP caps for UDP sources */
    caps_rtp = gst_caps_new_simple("application/x-rtp", "media", G_TYPE_STRING, "audio", "encoding-name", G_TYPE_STRING, "L16", "clock-rate", G_TYPE_INT, 48000,
                                   "channels", G_TYPE_INT, 1, "payload", G_TYPE_INT, 96, NULL);

    /* Set audio caps for after depayloading */
    caps_audio = gst_caps_new_simple("audio/x-raw", "channels", G_TYPE_INT, 1, "rate", G_TYPE_INT, 48000, NULL);

    /* Configure source 1 (peer) */
    g_object_set(G_OBJECT(udpsrc1), "port", 9004, "caps", caps_rtp, NULL);
    g_object_set(G_OBJECT(rtpjitterbuffer1), "latency", 5, "drop-on-latency", TRUE, NULL);
    g_object_set(G_OBJECT(capsfilter1), "caps", caps_audio, NULL);
    g_object_set(G_OBJECT(volume1), "volume", params->nativegain, NULL);

    /* Configure source 2 (echo) */
    g_object_set(G_OBJECT(udpsrc2), "port", 9005, "caps", caps_rtp, NULL);
    g_object_set(G_OBJECT(rtpjitterbuffer2), "latency", 5, "drop-on-latency", TRUE, NULL);
    g_object_set(G_OBJECT(capsfilter2), "caps", caps_audio, NULL);
    g_object_set(G_OBJECT(volume2), "volume", params->echogain, NULL);

    /* Configure source 3 (microphone recording) */
    g_object_set(G_OBJECT(udpsrc3), "port", 9006, "caps", caps_rtp, NULL);
    g_object_set(G_OBJECT(rtpjitterbuffer3), "latency", 5, "drop-on-latency", TRUE, NULL);

    /* Configure opus encoders and file sinks */
    g_object_set(G_OBJECT(opusenc_mic), "bitrate", 128000, NULL);
    g_object_set(G_OBJECT(filesink_mic), "location", record_file_microphone, "sync", FALSE, "async", FALSE, NULL);

    g_object_set(G_OBJECT(opusenc_hp), "bitrate", 128000, NULL);
    g_object_set(G_OBJECT(filesink_hp), "location", record_file_headphones, "sync", FALSE, "async", FALSE, NULL);

    /* Configure audio sink */
    g_object_set(G_OBJECT(alsasink), "sync", FALSE, "async", FALSE, NULL);
    configure_audio_sink(alsasink, params->device);

    gst_caps_unref(caps_rtp);
    gst_caps_unref(caps_audio);

    /* Add all elements to pipeline */
    gst_bin_add_many(GST_BIN(context.pipeline), udpsrc1, rtpjitterbuffer1, rtpL16depay1, audioconvert1, capsfilter1, volume1, udpsrc2, rtpjitterbuffer2,
                     rtpL16depay2, audioconvert2, capsfilter2, volume2, udpsrc3, rtpjitterbuffer3, rtpL16depay3, audioconvert3, opusenc_mic, oggmux_mic,
                     filesink_mic, adder, tee, queue_speaker, queue_record, audioconvert_speaker, audioresample_speaker, alsasink, audioconvert_record,
                     audioresample_record, opusenc_hp, oggmux_hp, filesink_hp, NULL);

    /* Link source 1 (peer) to adder */
    if (!gst_element_link_many(udpsrc1, rtpjitterbuffer1, rtpL16depay1, audioconvert1, capsfilter1, volume1, NULL)) {
        g_printerr("Failed to link source 1 pipeline.\n");
        gst_object_unref(context.pipeline);
        g_free(recording_dir);
        g_free(record_file_microphone);
        g_free(record_file_headphones);
        return 1;
    }

    /* Link source 2 (echo) to adder */
    if (!gst_element_link_many(udpsrc2, rtpjitterbuffer2, rtpL16depay2, audioconvert2, capsfilter2, volume2, NULL)) {
        g_printerr("Failed to link source 2 pipeline.\n");
        gst_object_unref(context.pipeline);
        g_free(recording_dir);
        g_free(record_file_microphone);
        g_free(record_file_headphones);
        return 1;
    }

    /* Link source 3 (microphone recording) to file */
    if (!gst_element_link_many(udpsrc3, rtpjitterbuffer3, rtpL16depay3, audioconvert3, opusenc_mic, oggmux_mic, filesink_mic, NULL)) {
        g_printerr("Failed to link source 3 (microphone) pipeline.\n");
        gst_object_unref(context.pipeline);
        g_free(recording_dir);
        g_free(record_file_microphone);
        g_free(record_file_headphones);
        return 1;
    }

    /* Link adder to tee */
    if (!gst_element_link(adder, tee)) {
        g_printerr("Failed to link adder to tee.\n");
        gst_object_unref(context.pipeline);
        g_free(recording_dir);
        g_free(record_file_microphone);
        g_free(record_file_headphones);
        return 1;
    }

    /* Link tee branch 1 (to speaker) */
    if (!gst_element_link_many(tee, queue_speaker, audioconvert_speaker, audioresample_speaker, alsasink, NULL)) {
        g_printerr("Failed to link tee to speaker output.\n");
        gst_object_unref(context.pipeline);
        g_free(recording_dir);
        g_free(record_file_microphone);
        g_free(record_file_headphones);
        return 1;
    }

    /* Link tee branch 2 (to headphones recording) */
    if (!gst_element_link_many(tee, queue_record, audioconvert_record, audioresample_record, opusenc_hp, oggmux_hp, filesink_hp, NULL)) {
        g_printerr("Failed to link tee to headphones recording.\n");
        gst_object_unref(context.pipeline);
        g_free(recording_dir);
        g_free(record_file_microphone);
        g_free(record_file_headphones);
        return 1;
    }

    /* Manually link volume1 and volume2 to adder (they need sink pads) */
    src_pad1 = gst_element_get_static_pad(volume1, "src");
    adder_sink1 = gst_element_request_pad_simple(adder, "sink_%u");
    if (gst_pad_link(src_pad1, adder_sink1) != GST_PAD_LINK_OK) {
        g_printerr("Failed to link volume1 to adder.\n");
        gst_object_unref(context.pipeline);
        g_free(recording_dir);
        g_free(record_file_microphone);
        g_free(record_file_headphones);
        return 1;
    }
    gst_object_unref(src_pad1);

    src_pad2 = gst_element_get_static_pad(volume2, "src");
    adder_sink2 = gst_element_request_pad_simple(adder, "sink_%u");
    if (gst_pad_link(src_pad2, adder_sink2) != GST_PAD_LINK_OK) {
        g_printerr("Failed to link volume2 to adder.\n");
        gst_object_unref(context.pipeline);
        g_free(recording_dir);
        g_free(record_file_microphone);
        g_free(record_file_headphones);
        return 1;
    }
    gst_object_unref(src_pad2);

    /* Add a message handler */
    bus = gst_pipeline_get_bus(GST_PIPELINE(context.pipeline));
    bus_watch_id = gst_bus_add_watch(bus, bus_call, &context);
    gst_object_unref(bus);

    /* Set the pipeline to playing state */
    g_print("Starting receiver pipeline...\n");
    GstStateChangeReturn ret = gst_element_set_state(context.pipeline, GST_STATE_PLAYING);
    if (ret == GST_STATE_CHANGE_FAILURE) {
        g_printerr("Unable to set the pipeline to the playing state.\n");
        gst_object_unref(context.pipeline);
        g_free(recording_dir);
        g_free(record_file_microphone);
        g_free(record_file_headphones);
        return 1;
    }

    /* Create main loop and run */
    context.loop = g_main_loop_new(NULL, FALSE);
    g_print("Receiver running. Press Ctrl+C to stop.\n");
    g_main_loop_run(context.loop);

    /* Cleanup */
    g_print("Stopping receiver...\n");
    gst_element_set_state(context.pipeline, GST_STATE_NULL);
    gst_object_unref(context.pipeline);
    gst_object_unref(adder_sink1);
    gst_object_unref(adder_sink2);
    g_source_remove(bus_watch_id);
    g_main_loop_unref(context.loop);
    g_free(recording_dir);
    g_free(record_file_microphone);
    g_free(record_file_headphones);

    return 0;
}
