/*
 * EffectStreamer Core
 * @company Quality and Usability Lab | TU Berlin
 * @author  Eero Kaan <eerokaan@qu.tu-berlin.de>
 */

#include "effectstreamer.h"

static void clear_audio_backend(AudioBackend* backend) {
    for (guint i = 0; i < backend->element_count; i++) {
        if (backend->elements[i]) gst_object_unref(backend->elements[i]);
    }
    memset(backend, 0, sizeof(*backend));
}

static void configure_host_source(GstElement* source, DeviceType device_type, const char* device_id) {
    // clang-format off
    if (device_type == DEVICE_TYPE_WASAPI2) {
        g_object_set(
            G_OBJECT(source),
            "device", device_id,
            "exclusive", TRUE,
            "buffer-time", (gint64)15000,
            "latency-time", (gint64)5000,
            NULL
        );
    } else {
        g_object_set(
            G_OBJECT(source),
            "device", device_id,
            "buffer-time", (gint64)5000,
            "latency-time", (gint64)1000,
            NULL
        );
    }
    // clang-format on
}

static void configure_host_sink(GstElement* sink, DeviceType device_type, const char* device_id) {
    // clang-format off
    if (device_type == DEVICE_TYPE_WASAPI2) {
        g_object_set(
            G_OBJECT(sink),
            "device", device_id,
            "exclusive", TRUE,
            "buffer-time", (gint64)15000,
            "latency-time", (gint64)5000,
            "sync", FALSE,
            "async", FALSE,
            NULL
        );
    } else {
        g_object_set(
            G_OBJECT(sink),
            "device", device_id,
            "buffer-time", (gint64)5000,
            "latency-time", (gint64)1000,
            "sync", FALSE,
            "async", FALSE,
            NULL
        );
    }
    // clang-format on
}

const char* get_platform_name(void) {
    return PLATFORM_WINDOWS ? "Windows" : "Linux";
}

gboolean is_sender_mode(const char* mode) {
    return g_strcmp0(mode, "sender") == 0;
}

gboolean is_receiver_mode(const char* mode) {
    return g_strcmp0(mode, "receiver") == 0;
}

const char* get_device_type_name(DeviceType device_type) {
    switch (device_type) {
        case DEVICE_TYPE_ALSA:
            return "alsa";
        case DEVICE_TYPE_WASAPI2:
            return "wasapi2";
        case DEVICE_TYPE_STDIO:
            return "stdio";
        default:
            return "unknown";
    }
}

const char* get_supported_device_type_names(void) {
    return PLATFORM_WINDOWS ? "wasapi2 or stdio" : "alsa or stdio";
}

gboolean is_device_type_supported(DeviceType device_type) {
    if (device_type == DEVICE_TYPE_STDIO) return TRUE;
    return PLATFORM_WINDOWS ? device_type == DEVICE_TYPE_WASAPI2 : device_type == DEVICE_TYPE_ALSA;
}

GstElement* create_element(const char* factory_name, const char* element_name) {
    GstElement* element = gst_element_factory_make(factory_name, element_name);
    if (!element) g_printerr("Error: Required GStreamer element '%s' is unavailable.\n", factory_name);
    return element;
}

GstElement* create_and_add_element(GstBin* bin, const char* factory_name, const char* element_name) {
    GstElement* element = create_element(factory_name, element_name);

    if (element && !gst_bin_add(bin, element)) {
        g_printerr("Error: Could not add GStreamer element '%s' to the pipeline.\n", factory_name);
        gst_object_unref(element);
        return NULL;
    }
    
    return element;
}

char* get_first_audio_device(DeviceType device_type, const char* mode) {
    GstDeviceMonitor* monitor;
    GList* devices;
    gchar* found_id = NULL;
    const char* expected_api = get_device_type_name(device_type);
    const char* device_class = is_sender_mode(mode) ? "Audio/Source" : "Audio/Sink";

    if (device_type != DEVICE_TYPE_ALSA && device_type != DEVICE_TYPE_WASAPI2) {
        return NULL;
    }

    monitor = gst_device_monitor_new();
    gst_device_monitor_add_filter(monitor, device_class, NULL);

    if (!gst_device_monitor_start(monitor)) {
        g_printerr("Error: Failed to start GStreamer device monitor for %s devices.\n", expected_api);
        gst_object_unref(monitor);
        return NULL;
    }

    devices = gst_device_monitor_get_devices(monitor);
    for (GList* item = devices; item != NULL; item = item->next) {
        GstDevice* device = GST_DEVICE(item->data);
        GstStructure* properties = gst_device_get_properties(device);
        const gchar* api;
        const gchar* id;

        if (!properties) continue;

        api = gst_structure_get_string(properties, "device.api");
        id = gst_structure_get_string(properties, "device.id");
        if (!id && device_type == DEVICE_TYPE_WASAPI2) id = gst_structure_get_string(properties, "device.actual-id");
        if (!id && device_type == DEVICE_TYPE_ALSA) id = gst_structure_get_string(properties, "device.path");

        if (api && id && g_strcmp0(api, expected_api) == 0) {
            found_id = g_strdup(id);
            g_printerr("Found %s %s device: %s\n", expected_api, is_sender_mode(mode) ? "source" : "sink", id);
            gst_structure_free(properties);
            break;
        }

        gst_structure_free(properties);
    }

    g_list_free_full(devices, (GDestroyNotify)gst_object_unref);
    gst_device_monitor_stop(monitor);
    gst_object_unref(monitor);

    return found_id;
}

gboolean create_audio_source(DeviceType device_type, const char* device_id, AudioBackend* backend) {
    const char* factory_name;
    memset(backend, 0, sizeof(*backend));

    if (device_type == DEVICE_TYPE_STDIO) {
        backend->elements[0] = create_element("fdsrc", "audio-source");
        backend->element_count = 1;

        if (!backend->elements[0]) {
            return FALSE;
        }

        backend->elements[1] = create_element("rawaudioparse", "audio-parser");
        backend->element_count = 2;

        if (!backend->elements[1]) {
            clear_audio_backend(backend);
            return FALSE;
        }

        // clang-format off
        g_object_set(
            G_OBJECT(backend->elements[0]),
            "fd", 0,
            "is-live", TRUE,
            "blocksize", (guint)512,
            NULL
        );
        g_object_set(
            G_OBJECT(backend->elements[1]),
            "use-sink-caps", FALSE,
            "sample-rate", 48000,
            "num-channels", 1,
            "interleaved", TRUE,
            NULL
        );
        gst_util_set_object_arg(G_OBJECT(backend->elements[1]), "format", "pcm");
        gst_util_set_object_arg(G_OBJECT(backend->elements[1]), "pcm-format", "f32le");
        // clang-format on

        return TRUE;
    }

    factory_name = device_type == DEVICE_TYPE_WASAPI2 ? "wasapi2src" : "alsasrc";
    backend->elements[0] = create_element(factory_name, "audio-source");
    backend->element_count = 1;

    if (!backend->elements[0]) {
        return FALSE;
    }

    configure_host_source(backend->elements[0], device_type, device_id);
    return TRUE;
}

gboolean create_audio_sink(DeviceType device_type, const char* device_id, AudioBackend* backend) {
    GstCaps* caps;
    const char* factory_name;
    memset(backend, 0, sizeof(*backend));

    if (device_type == DEVICE_TYPE_STDIO) {
        backend->elements[0] = create_element("capsfilter", "stdio-caps");
        backend->element_count = 1;

        if (!backend->elements[0]) {
            return FALSE;
        }

        backend->elements[1] = create_element("audiobuffersplit", "audio-buffer-split");
        backend->element_count = 2;

        if (!backend->elements[1]) {
            clear_audio_backend(backend);
            return FALSE;
        }

        backend->elements[2] = create_element("fdsink", "audio-output");
        backend->element_count = 3;

        if (!backend->elements[2]) {
            clear_audio_backend(backend);
            return FALSE;
        }

        // clang-format off
        caps = gst_caps_new_simple(
            "audio/x-raw",
            "format", G_TYPE_STRING, "F32LE",
            "layout", G_TYPE_STRING, "interleaved",
            "channels", G_TYPE_INT, 1,
            "rate", G_TYPE_INT, 48000,
            NULL
        );
        g_object_set(
            G_OBJECT(backend->elements[0]),
            "caps", caps,
            NULL
        );
        gst_caps_unref(caps);
        
        g_object_set(
            G_OBJECT(backend->elements[1]),
            "output-buffer-size", (guint)512,
            "strict-buffer-size",
            TRUE,
            NULL
        );
        g_object_set(
            G_OBJECT(backend->elements[2]),
            "fd", 1,
            "sync", FALSE,
            "async", FALSE,
            NULL
        );
        // clang-format on

        return TRUE;
    }

    factory_name = device_type == DEVICE_TYPE_WASAPI2 ? "wasapi2sink" : "alsasink";
    backend->elements[0] = create_element(factory_name, "audio-output");
    backend->element_count = 1;

    if (!backend->elements[0]) {
        return FALSE;
    }

    configure_host_sink(backend->elements[0], device_type, device_id);
    return TRUE;
}

gboolean add_audio_backend(GstBin* bin, AudioBackend* backend) {
    for (guint i = 0; i < backend->element_count; i++) {
        if (gst_bin_add(bin, backend->elements[i])) continue;

        for (guint j = i; j < backend->element_count; j++) {
            if (backend->elements[j]) gst_object_unref(backend->elements[j]);
            backend->elements[j] = NULL;
        }
        backend->element_count = i;

        g_printerr("Error: Could not add audio backend element to the pipeline.\n");
        return FALSE;
    }

    for (guint i = 1; i < backend->element_count; i++) {
        if (!gst_element_link(backend->elements[i - 1], backend->elements[i])) {
            g_printerr("Error: Could not link audio backend elements.\n");
            return FALSE;
        }
    }

    return TRUE;
}

GstElement* get_audio_backend_first(AudioBackend* backend) {
    return backend->elements[0];
}

GstElement* get_audio_backend_last(AudioBackend* backend) {
    return backend->elements[backend->element_count - 1];
}
