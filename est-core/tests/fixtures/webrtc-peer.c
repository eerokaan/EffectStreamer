// Independent GStreamer offerer used only by process-level WebRTC tests.
#include <gst/gst.h>
#include <gst/sdp/sdp.h>
#include <gst/webrtc/webrtc.h>
#include "control/control.h"

typedef struct {GMainLoop* loop;GstElement* pipeline;GstElement* peer;GstElement* input;CoreControl* control;GAsyncQueue* messages;gint received;} Peer;
typedef struct {Peer* peer;cJSON* id;gboolean offer;} Operation;
static void completed(GstPromise* promise, gpointer data) {
    Operation* operation = data;
    cJSON* reply = cJSON_CreateObject();cJSON_AddItemToObject(reply, "id", operation->id);
    const GstStructure* result = gst_promise_wait(promise) == GST_PROMISE_RESULT_REPLIED ? gst_promise_get_reply(promise) : NULL;
    const GValue* error = result ? gst_structure_get_value(result, "error") : NULL;
    if (error) cJSON_AddStringToObject(reply, "error", "Peer negotiation failed");
    else if (operation->offer) {
        GstWebRTCSessionDescription* offer = NULL;
        if (result) gst_structure_get(result, "offer", GST_TYPE_WEBRTC_SESSION_DESCRIPTION, &offer, NULL);
        if (!offer) cJSON_AddStringToObject(reply, "error", "Peer offer missing");
        else {
            g_signal_emit_by_name(operation->peer->peer, "set-local-description", offer, NULL);
            gchar* sdp = gst_sdp_message_as_text(offer->sdp);
            cJSON* payload = cJSON_AddObjectToObject(reply, "payload");cJSON_AddStringToObject(payload, "type", "offer");cJSON_AddStringToObject(payload, "sdp", sdp);
            g_free(sdp);gst_webrtc_session_description_free(offer);
        }
    }
    g_async_queue_push(operation->peer->messages, reply);gst_promise_unref(promise);g_free(operation);
}
static gboolean deliver(gpointer data) {
    Peer* peer = data;cJSON* message;
    while ((message = g_async_queue_try_pop(peer->messages))) {
        const cJSON* event = cJSON_GetObjectItemCaseSensitive(message, "event");
        if (cJSON_IsString(event)) control_event(peer->control, event->valuestring, cJSON_GetObjectItemCaseSensitive(message, "payload"));
        else {
            const cJSON* error = cJSON_GetObjectItemCaseSensitive(message, "error");
            control_reply(peer->control, cJSON_GetObjectItemCaseSensitive(message, "id"), cJSON_GetObjectItemCaseSensitive(message, "payload"), cJSON_IsString(error) ? "negotiationFailed" : NULL, cJSON_IsString(error) ? error->valuestring : NULL);
        }
        cJSON_Delete(message);
    }
    return G_SOURCE_CONTINUE;
}
static void ice(GstElement* element, guint line, gchar* candidate, gpointer data) {
    (void)element;Peer* peer = data;
    cJSON* message = cJSON_CreateObject();cJSON_AddStringToObject(message, "event", "ice-candidate");
    cJSON* payload = cJSON_AddObjectToObject(message, "payload");cJSON_AddNumberToObject(payload, "sdpMLineIndex", line);cJSON_AddStringToObject(payload, "candidate", candidate);
    g_async_queue_push(peer->messages, message);
}
static void incoming(GstElement* element, GstPad* pad, gpointer data) {
    (void)element;Peer* peer = data;
    if (GST_PAD_DIRECTION(pad) != GST_PAD_SRC || !peer->input) return;
    GstPad* sink = gst_element_get_static_pad(peer->input, "sink");
    if (!gst_pad_is_linked(sink)) gst_pad_link(pad, sink);
    gst_object_unref(sink);
}
static void handoff(GstElement* sink, GstBuffer* buffer, GstPad* pad, gpointer data) {
    (void)sink;(void)buffer;(void)pad;Peer* peer = data;
    if (!g_atomic_int_compare_and_exchange(&peer->received, 0, 1)) return;
    cJSON* event = cJSON_CreateObject();cJSON_AddStringToObject(event, "event", "media-ready");g_async_queue_push(peer->messages, event);
}
static void request(CoreControl* control, const cJSON* message, gpointer data) {
    Peer* peer = data;
    if (!message) {g_main_loop_quit(peer->loop);return;}
    const cJSON* command = cJSON_GetObjectItemCaseSensitive(message, "command");
    const cJSON* payload = cJSON_GetObjectItemCaseSensitive(message, "payload");
    const cJSON* id = cJSON_GetObjectItemCaseSensitive(message, "id");
    if (!cJSON_IsString(command)) return;
    if (!strcmp(command->valuestring, "test.offer")) {
        Operation* operation = g_new0(Operation, 1);operation->peer = peer;operation->id = cJSON_Duplicate(id, TRUE);operation->offer = TRUE;
        g_signal_emit_by_name(peer->peer, "create-offer", NULL, gst_promise_new_with_change_func(completed, operation, NULL));
    }
    else if (!strcmp(command->valuestring, "webrtc.answer")) {
        const cJSON* text = cJSON_GetObjectItemCaseSensitive(payload, "sdp");GstSDPMessage* sdp = NULL;gst_sdp_message_new(&sdp);
        gst_sdp_message_parse_buffer((const guint8*)text->valuestring, strlen(text->valuestring), sdp);
        GstWebRTCSessionDescription* answer = gst_webrtc_session_description_new(GST_WEBRTC_SDP_TYPE_ANSWER, sdp);
        Operation* operation = g_new0(Operation, 1);operation->peer = peer;operation->id = cJSON_Duplicate(id, TRUE);
        g_signal_emit_by_name(peer->peer, "set-remote-description", answer, gst_promise_new_with_change_func(completed, operation, NULL));
        gst_webrtc_session_description_free(answer);
    }
    else if (!strcmp(command->valuestring, "webrtc.ice")) {
        const cJSON* candidate = cJSON_GetObjectItemCaseSensitive(payload, "candidate");
        g_signal_emit_by_name(peer->peer, "add-ice-candidate", 0, cJSON_IsString(candidate) ? candidate->valuestring : NULL);
        control_reply(control, id, NULL, NULL, NULL);
    }
    else if (!strcmp(command->valuestring, "shutdown")) {control_reply(control, id, NULL, NULL, NULL);g_main_loop_quit(peer->loop);}
}
static gboolean bus(GstBus* bus, GstMessage* message, gpointer data) {
    (void)bus;(void)data;
    if (GST_MESSAGE_TYPE(message) == GST_MESSAGE_ERROR) {GError* error = NULL;gchar* debug = NULL;gst_message_parse_error(message, &error, &debug);g_printerr("Peer: %s (%s)\n", error->message, debug ? debug : "");g_error_free(error);g_free(debug);}
    return G_SOURCE_CONTINUE;
}
int main(int argc, char** argv) {
    gst_init(NULL, NULL);Peer peer = {0};GError* error = NULL;
    gboolean sender = argc > 1 && !strcmp(argv[1], "sender");
    const char* description = sender ?
        "webrtcbin name=peer bundle-policy=max-bundle audiotestsrc is-live=true wave=silence samplesperbuffer=960 ! audioconvert ! opusenc frame-size=20 dtx=false ! rtpopuspay pt=109 ! application/x-rtp,media=audio,encoding-name=OPUS,clock-rate=48000,encoding-params=(string)2,payload=(int)109 ! peer." :
        "webrtcbin name=peer bundle-policy=max-bundle queue name=input ! rtpopusdepay ! opusdec ! fakesink name=audio sync=false async=false signal-handoffs=true";
    gchar* tone = argc > 2 && !strcmp(argv[2], "tone") ? g_strdup(description) : NULL;
    if (tone) {gchar* wave = strstr(tone, "wave=silence");if (wave) memcpy(wave, "wave=sine   ", 12);}
    peer.pipeline = gst_parse_launch(tone ? tone : description, &error);g_free(tone);
    if (!peer.pipeline || error) {g_printerr("Peer setup failed: %s\n", error ? error->message : "unknown");return 1;}
    peer.loop = g_main_loop_new(NULL, FALSE);peer.messages = g_async_queue_new();peer.peer = gst_bin_get_by_name(GST_BIN(peer.pipeline), "peer");
    if (!sender) {
        peer.input = gst_bin_get_by_name(GST_BIN(peer.pipeline), "input");
        GstElement* sink = gst_bin_get_by_name(GST_BIN(peer.pipeline), "audio");g_signal_connect(sink, "handoff", G_CALLBACK(handoff), &peer);gst_object_unref(sink);
        GstCaps* caps = gst_caps_from_string("application/x-rtp,media=audio,encoding-name=OPUS,clock-rate=48000,encoding-params=(string)2,payload=(int)109");
        GstWebRTCRTPTransceiver* transceiver = NULL;g_signal_emit_by_name(peer.peer, "add-transceiver", GST_WEBRTC_RTP_TRANSCEIVER_DIRECTION_RECVONLY, caps, &transceiver);gst_caps_unref(caps);if (transceiver) gst_object_unref(transceiver);
    }
    else {
        GstWebRTCRTPTransceiver* transceiver = NULL;g_signal_emit_by_name(peer.peer, "get-transceiver", 0, &transceiver);
        if (transceiver) {g_object_set(transceiver, "direction", GST_WEBRTC_RTP_TRANSCEIVER_DIRECTION_SENDONLY, NULL);gst_object_unref(transceiver);}
    }
    g_signal_connect(peer.peer, "on-ice-candidate", G_CALLBACK(ice), &peer);g_signal_connect(peer.peer, "pad-added", G_CALLBACK(incoming), &peer);
    GstBus* messages = gst_element_get_bus(peer.pipeline);guint watch = gst_bus_add_watch(messages, bus, &peer);
    peer.control = control_new(g_main_loop_get_context(peer.loop), request, &peer);guint dispatch = g_timeout_add(5, deliver, &peer);
    gst_element_set_state(peer.pipeline, GST_STATE_PLAYING);control_event(peer.control, "control-ready", NULL);g_main_loop_run(peer.loop);
    gst_element_set_state(peer.pipeline, GST_STATE_NULL);control_free(peer.control);g_source_remove(dispatch);g_source_remove(watch);
    gst_object_unref(messages);gst_clear_object(&peer.input);gst_object_unref(peer.peer);gst_object_unref(peer.pipeline);g_main_loop_unref(peer.loop);return 0;
}
