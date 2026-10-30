#include "lifecycle.h"
#include "device/webrtc.h"

static gboolean stop_timeout(gpointer data) {
    AppContext* context = data;
    context->stop_timeout = 0;
    g_mutex_lock(&context->error_lock); context->runtime_error = TRUE; g_mutex_unlock(&context->error_lock);
    control_event(context->control, "media-failed", NULL);
    g_main_loop_quit(context->loop);
    return G_SOURCE_REMOVE;
}
static void request_stop(AppContext* context) {
    if (context->stopping) return;
    context->stopping = TRUE;
    context->stop_timeout = g_timeout_add(5000, stop_timeout, context);
    if (context->gate) g_object_set(context->gate, "drop", FALSE, NULL);
    if (audio_backend_stop(context)) return;
    if (!gst_element_send_event(context->pipeline, gst_event_new_eos())) {
        g_mutex_lock(&context->error_lock); context->runtime_error = TRUE; g_mutex_unlock(&context->error_lock);
        g_main_loop_quit(context->loop);
    }
}
static void handle_request(CoreControl* control, const cJSON* request, gpointer data) {
    AppContext* context = data;
    if (!request) {request_stop(context); return;}
    const cJSON* id = cJSON_GetObjectItemCaseSensitive(request, "id");
    const cJSON* version = cJSON_GetObjectItemCaseSensitive(request, "version");
    const cJSON* type = cJSON_GetObjectItemCaseSensitive(request, "type");
    const cJSON* command = cJSON_GetObjectItemCaseSensitive(request, "command");
    const cJSON* payload = cJSON_GetObjectItemCaseSensitive(request, "payload");
    if (!cJSON_IsObject(request) || !cJSON_IsString(id) || !id->valuestring[0] || strlen(id->valuestring) > 128 ||
        !cJSON_IsNumber(version) || version->valuedouble != 1 || !cJSON_IsString(type) || strcmp(type->valuestring, "request") ||
        !cJSON_IsString(command) || !cJSON_IsObject(payload)) {
        control_reply(control, NULL, NULL, "invalidRequest", "Invalid versioned control request"); return;
    }
    if (context->stopping && strncmp(command->valuestring, "webrtc.", 7) == 0) {control_reply(control, id, NULL, "stopping", "Core is stopping");return;}
    if (audio_backend_handle_control(context, command->valuestring, id, payload)) return;
    if (strcmp(command->valuestring, "audio.start") == 0) {
        if (context->stopping) {control_reply(control, id, NULL, "stopping", "Core is stopping"); return;}
        if (context->preparation_volume) g_object_set(context->preparation_volume, "mute", FALSE, NULL);
        if (context->gate) g_object_set(context->gate, "drop", FALSE, NULL);
        context->started = TRUE;
        control_reply(control, id, NULL, NULL, NULL);
    } else if (!strcmp(command->valuestring, "audio.prime")) {
        if (!context->webrtc || !context->preparation_volume || context->started || context->stopping) {
            control_reply(control, id, NULL, "invalidPhase", "Only a prepared WebRTC sender can prime silence");return;
        }
        g_object_set(context->preparation_volume, "mute", TRUE, NULL);
        g_object_set(context->gate, "drop", FALSE, NULL);
        control_reply(control, id, NULL, NULL, NULL);
    } else if (!strcmp(command->valuestring, "audio.stop") || !strcmp(command->valuestring, "shutdown")) {
        control_reply(control, id, NULL, NULL, NULL);
        request_stop(context);
    } else control_reply(control, id, NULL, "unsupported", "Unsupported core command");
}
static GstPadProbeReturn first_media(GstPad* pad, GstPadProbeInfo* info, gpointer data) {
    AppContext* context = data;
    (void)pad; (void)info;
    if (g_atomic_int_compare_and_exchange(&context->media_reported, 0, 1)) {
        gst_element_post_message(context->pipeline, gst_message_new_application(GST_OBJECT(context->pipeline), gst_structure_new_empty("est-media-ready")));
    }
    return GST_PAD_PROBE_REMOVE;
}
void lifecycle_bus(AppContext* context, GstMessage* message) {
    if (GST_MESSAGE_TYPE(message) == GST_MESSAGE_APPLICATION && gst_structure_has_name(gst_message_get_structure(message), "est-media-ready")) {
        control_event(context->control, "media-ready", NULL);
    }
    if (GST_MESSAGE_TYPE(message) == GST_MESSAGE_APPLICATION && gst_structure_has_name(gst_message_get_structure(message), "est-branch-eos")) {
        context->eos_branches_finished++;
        if (context->stopping && context->eos_branches_finished == context->eos_branches) lifecycle_eos(context);
    }
}
void lifecycle_prepare(AppContext* context, gboolean managed, GstElement* gate, GstElement* media_tap) {
    context->gate = gate;
    if (!managed) return;
    if (gate) g_object_set(gate, "drop", TRUE, NULL);
    context->control = control_new(g_main_loop_get_context(context->loop), handle_request, context);
    GstPad* pad = gst_element_get_static_pad(media_tap, "src");
    gst_pad_add_probe(pad, GST_PAD_PROBE_TYPE_BUFFER, first_media, context, NULL);
    gst_object_unref(pad);
}
void lifecycle_eos(AppContext* context) {
    context->eos_received = TRUE;
    g_main_loop_quit(context->loop);
}
void lifecycle_finish(AppContext* context, gboolean success, gboolean recording) {
    if (context->stop_timeout) {g_source_remove(context->stop_timeout);context->stop_timeout = 0;}
    if (!context->control) return;
    if (success && context->eos_received && recording) control_event(context->control, "recording-finalized", NULL);
    control_event(context->control, success ? "stopped" : "media-failed", NULL);
    control_free(context->control);context->control = NULL;
}
