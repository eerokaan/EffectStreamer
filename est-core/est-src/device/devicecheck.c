#include <math.h>
#include "devicecheck.h"
#include "cJSON.h"

typedef struct {
    GMainLoop* loop;
    GMutex lock;
    gboolean input;
    gboolean observed;
    gboolean failed;
    gboolean ended;
    double peak;
    char* error;
} DeviceCheck;

static GstPadProbeReturn observe_input(GstPad* pad, GstPadProbeInfo* info, gpointer data) {
    DeviceCheck* check = data;
    GstBuffer* buffer = GST_PAD_PROBE_INFO_BUFFER(info);
    GstMapInfo map;
    (void)pad;
    if (gst_buffer_map(buffer, &map, GST_MAP_READ)) {
        double peak = 0;
        for (gsize i = 0; i + 4 <= map.size; i += 4) {
            guint32 bits; float sample;
            memcpy(&bits, map.data + i, 4);bits = GUINT32_FROM_LE(bits);memcpy(&sample, &bits, 4);
            if (isfinite(sample)) peak = MAX(peak, fabs(sample));
        }
        g_mutex_lock(&check->lock);
        check->observed = check->observed || map.size > 0;
        check->peak = MIN(1.0, MAX(check->peak, peak));
        g_mutex_unlock(&check->lock);
        gst_buffer_unmap(buffer, &map);
    }
    return GST_PAD_PROBE_OK;
}
static gboolean check_bus(GstBus* bus, GstMessage* message, gpointer data) {
    DeviceCheck* check = data;
    (void)bus;
    if (GST_MESSAGE_TYPE(message) == GST_MESSAGE_ERROR) {
        GError* error = NULL; gchar* debug = NULL;
        gst_message_parse_error(message, &error, &debug);
        check->failed = TRUE;check->error = g_strdup(error->message);
        g_error_free(error);g_free(debug);g_main_loop_quit(check->loop);
    } else if (GST_MESSAGE_TYPE(message) == GST_MESSAGE_EOS) {
        check->ended = TRUE;g_main_loop_quit(check->loop);
    }
    return G_SOURCE_CONTINUE;
}
static gboolean check_timeout(gpointer data) {
    DeviceCheck* check = data;
    if (!check->input) {check->failed = TRUE;check->error = g_strdup("Test playback timed out");}
    g_main_loop_quit(check->loop);
    // Keep this source alive until the uniform cleanup removes it.
    return G_SOURCE_CONTINUE;
}
int run_device_check(DeviceType type, const char* id, const char* mode, const char* file, int duration_ms) {
    DeviceCheck check = {0};
    AudioBackend backend = {0};
    GstElement* pipeline = gst_pipeline_new("device-check");
    GstBus* bus = NULL;
    guint bus_watch = 0, timeout = 0;
    gboolean ok = FALSE;
    check.input = !strcmp(mode, "test-input");check.loop = g_main_loop_new(NULL, FALSE);g_mutex_init(&check.lock);
    if (!pipeline) goto cleanup;
    if (!(check.input ? create_audio_source(type, id, &backend) : create_audio_sink(type, id, &backend)) || !add_audio_backend(GST_BIN(pipeline), &backend)) goto cleanup;
    GstElement* convert = create_and_add_element(GST_BIN(pipeline), "audioconvert", NULL);
    GstElement* resample = create_and_add_element(GST_BIN(pipeline), "audioresample", NULL);
    if (!convert || !resample) goto cleanup;
    if (check.input) {
        GstElement* filter = create_and_add_element(GST_BIN(pipeline), "capsfilter", NULL);
        GstElement* sink = create_and_add_element(GST_BIN(pipeline), "fakesink", NULL);
        if (!filter || !sink) goto cleanup;
        GstCaps* caps = gst_caps_new_simple("audio/x-raw", "format", G_TYPE_STRING, "F32LE", "channels", G_TYPE_INT, 1, "rate", G_TYPE_INT, 48000, NULL);
        g_object_set(filter, "caps", caps, NULL);gst_caps_unref(caps);
        g_object_set(sink, "sync", FALSE, "async", FALSE, NULL);
        if (!gst_element_link_many(get_audio_backend_last(&backend), convert, resample, filter, sink, NULL)) goto cleanup;
        GstPad* pad = gst_element_get_static_pad(filter, "src");
        gst_pad_add_probe(pad, GST_PAD_PROBE_TYPE_BUFFER, observe_input, &check, NULL);gst_object_unref(pad);
    } else {
        GstElement* source = create_and_add_element(GST_BIN(pipeline), "filesrc", NULL);
        GstElement* parser = create_and_add_element(GST_BIN(pipeline), "wavparse", NULL);
        if (!source || !parser) goto cleanup;
        g_object_set(source, "location", file, NULL);
        if (!gst_element_link_many(source, parser, convert, resample, get_audio_backend_first(&backend), NULL)) goto cleanup;
    }
    bus = gst_element_get_bus(pipeline);bus_watch = gst_bus_add_watch(bus, check_bus, &check);
    timeout = g_timeout_add(check.input ? (guint)duration_ms : 30000, check_timeout, &check);
    if (gst_element_set_state(pipeline, GST_STATE_PLAYING) == GST_STATE_CHANGE_FAILURE) {
        check.failed = TRUE;check.error = g_strdup("Could not open selected native device");
    } else g_main_loop_run(check.loop);
    gst_element_set_state(pipeline, GST_STATE_NULL);
    ok = !check.failed && (check.input ? check.observed : check.ended);
cleanup:
    if (timeout) g_source_remove(timeout);
    if (bus_watch) g_source_remove(bus_watch);
    if (pipeline) {gst_element_set_state(pipeline, GST_STATE_NULL);gst_object_unref(pipeline);}
    if (bus) gst_object_unref(bus);
    cJSON* result = cJSON_CreateObject();cJSON_AddBoolToObject(result, "ok", ok);
    if (ok && check.input) {cJSON_AddBoolToObject(result, "inputUsable", TRUE);cJSON_AddNumberToObject(result, "peak", check.peak);}
    if (!ok) cJSON_AddStringToObject(result, "error", check.error ? check.error : "Native device check failed or received no input");
    char* json = cJSON_PrintUnformatted(result);if (json) {puts(json);cJSON_free(json);}cJSON_Delete(result);
    g_free(check.error);g_main_loop_unref(check.loop);g_mutex_clear(&check.lock);
    return ok ? 0 : 1;
}
