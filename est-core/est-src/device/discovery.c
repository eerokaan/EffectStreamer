#include "discovery.h"
#include "cJSON.h"

static void add_device(cJSON* array, const char* id, const char* label, gboolean is_default) {
    cJSON* item = cJSON_CreateObject();
    cJSON_AddStringToObject(item, "id", id);
    cJSON_AddStringToObject(item, "label", label);
    cJSON_AddBoolToObject(item, "isDefault", is_default);
    cJSON_AddItemToArray(array, item);
}
static cJSON* collect_native_devices(DeviceType type) {
    cJSON* result = cJSON_CreateObject();
    cJSON* inputs = cJSON_AddArrayToObject(result, "inputs");
    cJSON* outputs = cJSON_AddArrayToObject(result, "outputs");
    const char* label = type == DEVICE_TYPE_ALSA ? "ALSA default route (availability checked by test)" : "WASAPI2 system default";
    add_device(inputs, "default", label, TRUE); add_device(outputs, "default", label, TRUE);
    GstDeviceMonitor* monitor = gst_device_monitor_new();
    gst_device_monitor_set_show_all_devices(monitor, TRUE);
    gst_device_monitor_add_filter(monitor, "Audio/Source", NULL);
    gst_device_monitor_add_filter(monitor, "Audio/Sink", NULL);
    if (gst_device_monitor_start(monitor)) {
        GList* devices = gst_device_monitor_get_devices(monitor);
        for (GList* node = devices; node; node = node->next) {
            GstDevice* device = GST_DEVICE(node->data);
            GstElement* element = gst_device_create_element(device, NULL);
            if (!element) continue;
            GstElementFactory* factory = gst_element_get_factory(element);
            const char* name = factory ? gst_plugin_feature_get_name(GST_PLUGIN_FEATURE(factory)) : "";
            gboolean input = !strcmp(name, type == DEVICE_TYPE_ALSA ? "alsasrc" : "wasapi2src");
            gboolean output = !strcmp(name, type == DEVICE_TYPE_ALSA ? "alsasink" : "wasapi2sink");
            if (input || output) {
                gchar* id = NULL;
                gchar* display = gst_device_get_display_name(device);
                g_object_get(element, "device", &id, NULL);
                if (id && id[0] && strcmp(id, "default")) {
                    GstStructure* properties = gst_device_get_properties(device);
                    gboolean is_default = FALSE;
                    if (properties) {gst_structure_get_boolean(properties, "is-default", &is_default);gst_structure_free(properties);}
                    add_device(input ? inputs : outputs, id, display, is_default);
                }
                g_free(display);g_free(id);
            }
            gst_object_unref(element);
        }
        g_list_free_full(devices, (GDestroyNotify)gst_object_unref);
        gst_device_monitor_stop(monitor);
    }
    gst_object_unref(monitor);
    return result;
}
char* get_first_audio_device(DeviceType type, const char* mode) {
    cJSON* devices = collect_native_devices(type);
    cJSON* array = cJSON_GetObjectItemCaseSensitive(devices, is_sender_mode(mode) ? "inputs" : "outputs");
    // Entry zero is the explicit logical default route, not detected hardware.
    const cJSON* item = cJSON_GetArrayItem(array, 1);
    const cJSON* id = cJSON_GetObjectItemCaseSensitive(item, "id");
    gchar* selected = cJSON_IsString(id) ? g_strdup(id->valuestring) : NULL;
    cJSON_Delete(devices);
    return selected;
}
int print_native_devices(DeviceType type) {
    cJSON* result = collect_native_devices(type);
    char* serialized = cJSON_PrintUnformatted(result);
    if (serialized) {puts(serialized);cJSON_free(serialized);}
    cJSON_Delete(result);
    return 0;
}
