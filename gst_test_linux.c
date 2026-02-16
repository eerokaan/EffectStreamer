#include <gst/gst.h>

int main(int argc, char *argv[])
{
    GstElement *pipeline;
    GstBus *bus;
    GstMessage *msg;
    GError *error = NULL;

    gst_init(&argc, &argv);

    pipeline = gst_parse_launch(
        "audiotestsrc wave=sine ! alsasink device=hw:0,0",
        &error);

    if (!pipeline) {
        g_printerr("Pipeline error: %s\n", error->message);
        g_clear_error(&error);
        return 1;
    }

    gst_element_set_state(pipeline, GST_STATE_PLAYING);

    bus = gst_element_get_bus(pipeline);
    msg = gst_bus_timed_pop_filtered(
        bus,
        GST_CLOCK_TIME_NONE,
        GST_MESSAGE_ERROR | GST_MESSAGE_EOS);

    if (msg)
        gst_message_unref(msg);

    gst_object_unref(bus);
    gst_element_set_state(pipeline, GST_STATE_NULL);
    gst_object_unref(pipeline);

    return 0;
}
