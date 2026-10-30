#include <errno.h>
#include "wav.h"

static gboolean add_wav_branch(GstElement* pipeline, GstElement* source, const char* directory, const char* track) {
    GstBin* bin = GST_BIN(pipeline);
    gchar* filename = g_strdup_printf("%s.wav", track);
    gchar* location = g_build_filename(directory, filename, NULL);
    GstElement* queue = create_and_add_element(bin, "queue", NULL);
    GstElement* convert = create_and_add_element(bin, "audioconvert", NULL);
    GstElement* resample = create_and_add_element(bin, "audioresample", NULL);
    GstElement* filter = create_and_add_element(bin, "capsfilter", NULL);
    GstElement* encoder = create_and_add_element(bin, "wavenc", NULL);
    gchar* sink_name = g_strdup_printf("wav-%s", track);
    GstElement* sink = create_and_add_element(bin, "filesink", sink_name);g_free(sink_name);
    gboolean ok = FALSE;
    if (!queue || !convert || !resample || !filter || !encoder || !sink) goto cleanup;
    GstCaps* caps = gst_caps_new_simple("audio/x-raw", "format", G_TYPE_STRING, "S16LE", "layout", G_TYPE_STRING, "interleaved", "channels", G_TYPE_INT, 1, "rate", G_TYPE_INT, 48000, NULL);
    g_object_set(filter, "caps", caps, NULL); gst_caps_unref(caps);
    g_object_set(sink, "location", location, "sync", FALSE, "async", FALSE, NULL);
    ok = gst_element_link_many(source, queue, convert, resample, filter, encoder, sink, NULL);
    if (!ok) g_printerr("Error: Could not link %s WAV recording branch.\n", track);
cleanup:
    g_free(filename); g_free(location);
    return ok;
}
gboolean wav_recording_add(GstElement* pipeline, GstElement* playback_tee, const char* directory, const char* address, int port) {
    gchar* fallback = directory ? NULL : g_build_filename(g_get_home_dir(), "effectstreamer", NULL);
    if (!directory) directory = fallback;
    if (g_mkdir_with_parents(directory, 0755) != 0) {
        g_printerr("Error: Could not create recording directory %s: %s\n", directory, g_strerror(errno));
        g_free(fallback); return FALSE;
    }
    GstBin* bin = GST_BIN(pipeline);
    GstElement* source = create_and_add_element(bin, "udpsrc", "udpsrc-record");
    GstElement* jitter = create_and_add_element(bin, "rtpjitterbuffer", "jitterbuffer-record");
    GstElement* depay = create_and_add_element(bin, "rtpL16depay", "depay-record");
    gboolean ok = FALSE;
    if (!source || !jitter || !depay) goto cleanup;
    GstCaps* caps = gst_caps_new_simple("application/x-rtp", "media", G_TYPE_STRING, "audio", "encoding-name", G_TYPE_STRING, "L16", "clock-rate", G_TYPE_INT, 48000, "channels", G_TYPE_INT, 1, "payload", G_TYPE_INT, 96, NULL);
    g_object_set(source, "port", port, "address", address, "reuse", FALSE, "caps", caps, NULL); gst_caps_unref(caps);
    g_object_set(jitter, "latency", 5, "drop-on-latency", TRUE, NULL);
    ok = gst_element_link_many(source, jitter, depay, NULL) &&
         add_wav_branch(pipeline, depay, directory, "microphone") &&
         add_wav_branch(pipeline, playback_tee, directory, "headphones");
cleanup:
    g_free(fallback);
    return ok;
}
