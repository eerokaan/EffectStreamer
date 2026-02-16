#include <gst/gst.h>

static gchar *get_first_wasapi2_sink_id(void)
{
    GstDeviceMonitor *mon = gst_device_monitor_new();

    // Filter to audio sinks (caps are optional here)
    gst_device_monitor_add_filter(mon, "Audio/Sink", NULL);

    if (!gst_device_monitor_start(mon)) {
        g_printerr("Failed to start GstDeviceMonitor\n");
        gst_object_unref(mon);
        return NULL;
    }

    GList *devices = gst_device_monitor_get_devices(mon);
    gchar *found_id = NULL;

    for (GList *l = devices; l != NULL; l = l->next) {
        GstDevice *dev = GST_DEVICE(l->data);
        GstStructure *props = gst_device_get_properties(dev);
        if (!props)
            continue;

        const gchar *api = gst_structure_get_string(props, "device.api");
        const gchar *id  = gst_structure_get_string(props, "device.id");
        if (!id)
            id = gst_structure_get_string(props, "device.actual-id");

        if (api && id && g_strcmp0(api, "wasapi2") == 0) {
            found_id = g_strdup(id);
            gst_structure_free(props);
            break;
        }

        gst_structure_free(props);
    }

    g_list_free_full(devices, (GDestroyNotify) gst_object_unref);
    gst_device_monitor_stop(mon);
    gst_object_unref(mon);
    return found_id; // free with g_free()
}

int main(int argc, char *argv[])
{
    gst_init(&argc, &argv);

    gchar *id = get_first_wasapi2_sink_id();
    if (!id) {
        g_printerr("No WASAPI2 sink device found\n");
        return 1;
    }
    g_print("Using WASAPI2 sink id: %s\n", id);

    GstElement *pipeline = gst_pipeline_new(NULL);
    GstElement *src  = gst_element_factory_make("audiotestsrc", NULL);
    GstElement *sink = gst_element_factory_make("wasapi2sink", NULL);

    if (!pipeline || !src || !sink) {
        g_printerr("Failed to create elements\n");
        g_free(id);
        return 1;
    }

    g_object_set(src, "wave", 0, NULL); // 0 = sine

    // Set a specific device
    g_object_set(sink, "device", id, NULL);

    // Optional tuning:
    // - exclusive=true forces exclusive mode; low-latency is mainly relevant in shared mode
    // g_object_set(sink, "exclusive", TRUE, "low-latency", TRUE, NULL);

    gst_bin_add_many(GST_BIN(pipeline), src, sink, NULL);

    if (!gst_element_link(src, sink)) {
        g_printerr("Failed to link\n");
        g_free(id);
        gst_object_unref(pipeline);
        return 1;
    }

    gst_element_set_state(pipeline, GST_STATE_PLAYING);

    GstBus *bus = gst_element_get_bus(pipeline);
    GstMessage *msg = gst_bus_timed_pop_filtered(
        bus, GST_CLOCK_TIME_NONE, GST_MESSAGE_ERROR | GST_MESSAGE_EOS);

    if (msg) gst_message_unref(msg);
    gst_object_unref(bus);

    gst_element_set_state(pipeline, GST_STATE_NULL);
    gst_object_unref(pipeline);
    g_free(id);
    return 0;
}

