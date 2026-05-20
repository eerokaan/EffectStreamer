/*
 * EffectStreamer Core
 * @company Quality and Usability Lab | TU Berlin
 * @author  Eero Kaan <eerokaan@qu.tu-berlin.de>
 */

#include "effectstreamer.h"

#ifdef PLATFORM_WINDOWS

/**
 * Get the first available WASAPI2 audio device
 * @param is_source: TRUE for source devices (microphones), FALSE for sink
 * devices (speakers)
 * @return Device ID string (caller must g_free), or NULL if none found
 */
char* get_first_audio_device(gboolean is_source) {
    GstDeviceMonitor* mon = gst_device_monitor_new();
    const char* device_class = is_source ? "Audio/Source" : "Audio/Sink";

    /* Filter to audio sources or sinks */
    gst_device_monitor_add_filter(mon, device_class, NULL);

    if (!gst_device_monitor_start(mon)) {
        g_printerr("Failed to start GstDeviceMonitor\n");
        gst_object_unref(mon);
        return NULL;
    }

    GList* devices = gst_device_monitor_get_devices(mon);
    gchar* found_id = NULL;

    for (GList* l = devices; l != NULL; l = l->next) {
        GstDevice* dev = GST_DEVICE(l->data);
        GstStructure* props = gst_device_get_properties(dev);
        if (!props) continue;

        const gchar* api = gst_structure_get_string(props, "device.api");
        const gchar* id = gst_structure_get_string(props, "device.id");
        if (!id) id = gst_structure_get_string(props, "device.actual-id");

        /* Look for WASAPI2 devices */
        if (api && id && g_strcmp0(api, "wasapi2") == 0) {
            found_id = g_strdup(id);
            g_print("Found WASAPI2 %s device: %s\n", is_source ? "source" : "sink", id);
            gst_structure_free(props);
            break;
        }

        gst_structure_free(props);
    }

    g_list_free_full(devices, (GDestroyNotify)gst_object_unref);
    gst_device_monitor_stop(mon);
    gst_object_unref(mon);

    return found_id;
}

/**
 * Configure audio source element with platform-specific properties
 */
void configure_audio_source(GstElement* src, const char* device) {
    g_object_set(G_OBJECT(src), "device", device, "exclusive", TRUE, "buffer-time", (gint64)15000, "latency-time", (gint64)5000, NULL);
}

/**
 * Configure audio sink element with platform-specific properties
 */
void configure_audio_sink(GstElement* sink, const char* device) {
    g_object_set(G_OBJECT(sink), "device", device, "exclusive", TRUE, "buffer-time", (gint64)15000, "latency-time", (gint64)5000, "sync", FALSE, NULL);
}

/**
 * Get platform name for display
 */
const char* get_platform_name(void) { return "Windows (WASAPI2)"; }

#else

/**
 * Get the first available ALSA audio device
 * @param is_source: TRUE for source devices (microphones), FALSE for sink
 * devices (speakers)
 * @return Device ID string (caller must g_free), or NULL if none found
 */
char* get_first_audio_device(gboolean is_source) {
    GstDeviceMonitor* mon = gst_device_monitor_new();
    const char* device_class = is_source ? "Audio/Source" : "Audio/Sink";

    /* Filter to audio sources or sinks */
    gst_device_monitor_add_filter(mon, device_class, NULL);

    if (!gst_device_monitor_start(mon)) {
        g_printerr("Failed to start GstDeviceMonitor\n");
        gst_object_unref(mon);
        return NULL;
    }

    GList* devices = gst_device_monitor_get_devices(mon);
    gchar* found_id = NULL;

    for (GList* l = devices; l != NULL; l = l->next) {
        GstDevice* dev = GST_DEVICE(l->data);
        GstStructure* props = gst_device_get_properties(dev);
        if (!props) continue;

        const gchar* api = gst_structure_get_string(props, "device.api");
        const gchar* id = gst_structure_get_string(props, "device.id");
        if (!id) id = gst_structure_get_string(props, "device.path");

        /* Look for ALSA devices */
        if (api && id && g_strcmp0(api, "alsa") == 0) {
            found_id = g_strdup(id);
            g_print("Found ALSA %s device: %s\n", is_source ? "source" : "sink", id);
            gst_structure_free(props);
            break;
        }

        gst_structure_free(props);
    }

    g_list_free_full(devices, (GDestroyNotify)gst_object_unref);
    gst_device_monitor_stop(mon);
    gst_object_unref(mon);

    return found_id;
}

/**
 * Configure audio source element with platform-specific properties
 */
void configure_audio_source(GstElement* src, const char* device) {
    g_object_set(G_OBJECT(src), "device", device, "buffer-time", (gint64)5000, "latency-time", (gint64)1000, NULL);
}

/**
 * Configure audio sink element with platform-specific properties
 */
void configure_audio_sink(GstElement* sink, const char* device) {
    g_object_set(G_OBJECT(sink), "device", device, "buffer-time", (gint64)5000, "latency-time", (gint64)1000, "sync", FALSE, NULL);
}

/**
 * Get platform name for display
 */
const char* get_platform_name(void) { return "Linux (ALSA)"; }

#endif
