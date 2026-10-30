#include <math.h>
#include <gst/sdp/sdp.h>
#include <gst/webrtc/webrtc.h>
#include "webrtc.h"

typedef struct Offer Offer;
typedef struct {
    int kind;
    Offer* offer;
    GstWebRTCSessionDescription* answer;
    gchar* error;
    gchar* candidate;
    guint line;
    GstPad* pad;
    gulong probe;
    GstWebRTCPeerConnectionState state;
} Delivery;
struct WebRtcBackend {
    gint references;
    gint active;
    GMutex delivery_lock;
    AppContext* context;
    GstElement* webrtc;
    GstElement* input;
    GstElement* payloader;
    GstElement* capsfilter;
    GstPad* outgoing;
    GAsyncQueue* deliveries;
    GQueue candidates;
    GSource* source;
    gboolean sender;
    gboolean negotiating;
    gboolean remote_set;
};
struct Offer {
    WebRtcBackend* backend;
    cJSON* id;
    int stage;
    GstWebRTCSessionDescription* answer;
};
enum { OFFER, ICE, PAD, STATE };

static WebRtcBackend* retain(WebRtcBackend* backend) {g_atomic_int_inc(&backend->references);return backend;}
static void delivery_free(gpointer data);
static void release(WebRtcBackend* backend) {
    if (!g_atomic_int_dec_and_test(&backend->references)) return;
    g_async_queue_unref(backend->deliveries);
    while (!g_queue_is_empty(&backend->candidates)) delivery_free(g_queue_pop_head(&backend->candidates));
    gst_clear_object(&backend->input);gst_clear_object(&backend->webrtc);
    gst_clear_object(&backend->payloader);gst_clear_object(&backend->capsfilter);
    g_mutex_clear(&backend->delivery_lock);
    g_free(backend);
}
static void offer_free(Offer* offer) {
    if (!offer) return;
    cJSON_Delete(offer->id);
    if (offer->answer) gst_webrtc_session_description_free(offer->answer);
    release(offer->backend);g_free(offer);
}
static void delivery_free(gpointer data) {
    Delivery* delivery = data;
    if (delivery->pad) {if (delivery->probe) gst_pad_remove_probe(delivery->pad, delivery->probe);gst_object_unref(delivery->pad);}
    if (delivery->answer) gst_webrtc_session_description_free(delivery->answer);
    offer_free(delivery->offer);
    g_free(delivery->error);g_free(delivery->candidate);g_free(delivery);
}
static void enqueue(WebRtcBackend* backend, Delivery* delivery) {
    g_mutex_lock(&backend->delivery_lock);
    gboolean active = backend->active;
    if (active) g_async_queue_push(backend->deliveries, delivery);
    g_mutex_unlock(&backend->delivery_lock);
    if (!active) delivery_free(delivery);
}
static void promise_done(GstPromise* promise, gpointer data) {
    Offer* offer = data;
    Delivery* delivery = g_new0(Delivery, 1);
    delivery->kind = OFFER;delivery->offer = offer;
    if (gst_promise_wait(promise) != GST_PROMISE_RESULT_REPLIED) delivery->error = g_strdup("WebRTC negotiation was interrupted");
    else {
        const GstStructure* reply = gst_promise_get_reply(promise);
        const GValue* value = reply ? gst_structure_get_value(reply, "error") : NULL;
        if (value && G_VALUE_HOLDS(value, G_TYPE_ERROR)) {
            const GError* error = g_value_get_boxed(value);
            delivery->error = g_strdup(error ? error->message : "WebRTC negotiation failed");
        }
        if (!delivery->error && offer->stage == 1 && (!reply || !gst_structure_get(reply, "answer", GST_TYPE_WEBRTC_SESSION_DESCRIPTION, &delivery->answer, NULL))) delivery->error = g_strdup("WebRTC answer is missing");
    }
    gst_promise_unref(promise);
    enqueue(offer->backend, delivery);
}
static void issue(WebRtcBackend* backend, Offer* offer, const char* operation, GstWebRTCSessionDescription* description) {
    GstPromise* promise = gst_promise_new_with_change_func(promise_done, offer, NULL);
    g_signal_emit_by_name(backend->webrtc, operation, description, promise);
}
static void candidate_received(GstElement* webrtc, guint line, gchar* candidate, gpointer data) {
    (void)webrtc;
    WebRtcBackend* backend = data;
    Delivery* delivery = g_new0(Delivery, 1);delivery->kind = ICE;delivery->line = line;delivery->candidate = g_strdup(candidate);
    enqueue(backend, delivery);
}
static void gathering_changed(GObject* object, GParamSpec* property, gpointer data) {
    (void)property;
    GstWebRTCICEGatheringState state;
    g_object_get(object, "ice-gathering-state", &state, NULL);
    if (state == GST_WEBRTC_ICE_GATHERING_STATE_COMPLETE) candidate_received(GST_ELEMENT(object), 0, NULL, data);
}
static void connection_changed(GObject* object, GParamSpec* property, gpointer data) {
    (void)property;
    Delivery* delivery = g_new0(Delivery, 1);delivery->kind = STATE;
    g_object_get(object, "connection-state", &delivery->state, NULL);enqueue(data, delivery);
}
static GstPadProbeReturn block_pad(GstPad* pad, GstPadProbeInfo* info, gpointer data) {(void)pad;(void)info;(void)data;return GST_PAD_PROBE_OK;}
static void pad_added(GstElement* webrtc, GstPad* pad, gpointer data) {
    (void)webrtc;
    WebRtcBackend* backend = data;
    if (!backend->sender || GST_PAD_DIRECTION(pad) != GST_PAD_SRC) return;
    Delivery* delivery = g_new0(Delivery, 1);delivery->kind = PAD;delivery->pad = gst_object_ref(pad);
    delivery->probe = gst_pad_add_probe(pad, GST_PAD_PROBE_TYPE_BLOCK_DOWNSTREAM, block_pad, NULL, NULL);
    enqueue(backend, delivery);
}
static gboolean deliver(gpointer data) {
    WebRtcBackend* backend = data;
    for (int count = 0; count < 64; count++) {
        Delivery* delivery = g_async_queue_try_pop(backend->deliveries);
        if (!delivery) break;
        AppContext* context = backend->context;
        if (delivery->kind == OFFER) {
            Offer* offer = delivery->offer;delivery->offer = NULL;
            if (delivery->error || context->stopping) {
                backend->negotiating = FALSE;
                control_reply(context->control, offer->id, NULL, "negotiationFailed", delivery->error ? delivery->error : "Core is stopping");
                offer_free(offer);
            }
            else if (offer->stage == 0) {
                backend->remote_set = TRUE;
                while (!g_queue_is_empty(&backend->candidates)) {
                    Delivery* candidate = g_queue_pop_head(&backend->candidates);
                    g_signal_emit_by_name(backend->webrtc, "add-ice-candidate", candidate->line, candidate->candidate);
                    delivery_free(candidate);
                }
                offer->stage = 1;issue(backend, offer, "create-answer", NULL);
            }
            else if (offer->stage == 1) {
                offer->answer = delivery->answer;delivery->answer = NULL;
                offer->stage = 2;issue(backend, offer, "set-local-description", offer->answer);
            }
            else {
                gchar* sdp = gst_sdp_message_as_text(offer->answer->sdp);
                cJSON* payload = cJSON_CreateObject();cJSON_AddStringToObject(payload, "type", "answer");cJSON_AddStringToObject(payload, "sdp", sdp);
                control_reply(context->control, offer->id, payload, NULL, NULL);
                cJSON_Delete(payload);g_free(sdp);backend->negotiating = FALSE;offer_free(offer);
            }
        }
        else if (delivery->kind == ICE) {
            cJSON* payload = cJSON_CreateObject();cJSON_AddNumberToObject(payload, "sdpMLineIndex", delivery->line);
            if (delivery->candidate && delivery->candidate[0]) cJSON_AddStringToObject(payload, "candidate", delivery->candidate);
            else cJSON_AddNullToObject(payload, "candidate");
            control_event(context->control, "ice-candidate", payload);cJSON_Delete(payload);
        }
        else if (delivery->kind == PAD) {
            GstPad* sink = gst_element_get_static_pad(backend->input, "sink");
            if (!gst_pad_is_linked(sink) && gst_pad_link(delivery->pad, sink) != GST_PAD_LINK_OK) {
                g_mutex_lock(&context->error_lock);context->runtime_error = TRUE;g_mutex_unlock(&context->error_lock);
                control_event(context->control, "media-failed", NULL);g_main_loop_quit(context->loop);
            }
            gst_object_unref(sink);
        }
        else if (delivery->kind == STATE) {
            const char* states[] = {"new", "connecting", "connected", "disconnected", "failed", "closed"};
            cJSON* payload = cJSON_CreateObject();cJSON_AddStringToObject(payload, "state", states[MIN((guint)delivery->state, 5)]);
            control_event(context->control, "connection-state", payload);cJSON_Delete(payload);
            if (delivery->state == GST_WEBRTC_PEER_CONNECTION_STATE_FAILED && !context->stopping) {
                g_mutex_lock(&context->error_lock);context->runtime_error = TRUE;g_mutex_unlock(&context->error_lock);
                control_event(context->control, "media-failed", NULL);g_main_loop_quit(context->loop);
            }
        }
        delivery_free(delivery);
    }
    return G_SOURCE_CONTINUE;
}
static gboolean find_opus(GstSDPMessage* sdp, guint* payload) {
    if (gst_sdp_message_medias_len(sdp) != 1) return FALSE;
    const GstSDPMedia* media = gst_sdp_message_get_media(sdp, 0);
    if (g_strcmp0(gst_sdp_media_get_media(media), "audio")) return FALSE;
    for (guint i = 0; i < gst_sdp_media_attributes_len(media); i++) {
        const GstSDPAttribute* attribute = gst_sdp_media_get_attribute(media, i);
        gchar encoding[64];guint pt;
        if (!g_strcmp0(attribute->key, "rtpmap") && attribute->value && sscanf(attribute->value, "%u %63s", &pt, encoding) == 2 && pt <= 127 && !g_ascii_strcasecmp(encoding, "opus/48000/2")) {*payload = pt;return TRUE;}
    }
    return FALSE;
}
gboolean audio_backend_handle_control(AppContext* context, const char* command, const cJSON* id, const cJSON* payload) {
    WebRtcBackend* backend = context->webrtc;
    if (!backend || strncmp(command, "webrtc.", 7)) return FALSE;
    if (!strcmp(command, "webrtc.ice")) {
        const cJSON* candidate = cJSON_GetObjectItemCaseSensitive(payload, "candidate");
        const cJSON* line = cJSON_GetObjectItemCaseSensitive(payload, "sdpMLineIndex");
        if ((!cJSON_IsNull(candidate) && !cJSON_IsString(candidate)) || !cJSON_IsNumber(line) || line->valuedouble != 0 ||
            (cJSON_IsString(candidate) && (strlen(candidate->valuestring) > 16384 || (candidate->valuestring[0] && strncmp(candidate->valuestring, "candidate:", 10))))) {
            control_reply(context->control, id, NULL, "invalidIce", "Invalid audio ICE candidate/m-line");return TRUE;
        }
        const char* text = cJSON_IsString(candidate) && candidate->valuestring[0] ? candidate->valuestring : NULL;
        if (backend->remote_set) g_signal_emit_by_name(backend->webrtc, "add-ice-candidate", 0, text);
        else {
            if (g_queue_get_length(&backend->candidates) >= 128) {control_reply(context->control, id, NULL, "iceLimit", "ICE candidate queue limit reached");return TRUE;}
            Delivery* queued = g_new0(Delivery, 1);queued->candidate = g_strdup(text);g_queue_push_tail(&backend->candidates, queued);
        }
        control_reply(context->control, id, NULL, NULL, NULL);return TRUE;
    }
    if (!strcmp(command, "webrtc.offer")) {
        const cJSON* type = cJSON_GetObjectItemCaseSensitive(payload, "type");
        const cJSON* text = cJSON_GetObjectItemCaseSensitive(payload, "sdp");
        GstSDPMessage* sdp = NULL;guint pt = 0;
        if (backend->negotiating || backend->remote_set) {control_reply(context->control, id, NULL, "offerActive", "A WebRTC offer is already active");return TRUE;}
        if (!cJSON_IsString(type) || strcmp(type->valuestring, "offer") || !cJSON_IsString(text) || gst_sdp_message_new(&sdp) != GST_SDP_OK ||
            gst_sdp_message_parse_buffer((const guint8*)text->valuestring, strlen(text->valuestring), sdp) != GST_SDP_OK || !find_opus(sdp, &pt)) {
            if (sdp) gst_sdp_message_free(sdp);
            control_reply(context->control, id, NULL, "invalidSdp", "SDP must offer one Opus audio stream");return TRUE;
        }
        if (!backend->sender && !backend->outgoing) {
            GstCaps* caps = gst_caps_new_simple("application/x-rtp", "media", G_TYPE_STRING, "audio", "encoding-name", G_TYPE_STRING, "OPUS", "clock-rate", G_TYPE_INT, 48000, "encoding-params", G_TYPE_STRING, "2", "payload", G_TYPE_INT, pt, NULL);
            g_object_set(backend->payloader, "pt", pt, NULL);g_object_set(backend->capsfilter, "caps", caps, NULL);gst_caps_unref(caps);
            backend->outgoing = gst_element_request_pad_simple(backend->webrtc, "sink_%u");
            GstPad* source = gst_element_get_static_pad(backend->capsfilter, "src");
            gboolean linked = backend->outgoing && gst_pad_link(source, backend->outgoing) == GST_PAD_LINK_OK;gst_object_unref(source);
            if (!linked) {gst_sdp_message_free(sdp);control_reply(context->control, id, NULL, "linkFailed", "Could not link WebRTC audio output");return TRUE;}
            GstWebRTCRTPTransceiver* transceiver = NULL;g_object_get(backend->outgoing, "transceiver", &transceiver, NULL);
            if (transceiver) {g_object_set(transceiver, "direction", GST_WEBRTC_RTP_TRANSCEIVER_DIRECTION_SENDONLY, NULL);gst_object_unref(transceiver);}
        }
        Offer* offer = g_new0(Offer, 1);offer->backend = retain(backend);offer->id = cJSON_Duplicate(id, TRUE);
        backend->negotiating = TRUE;
        GstWebRTCSessionDescription* description = gst_webrtc_session_description_new(GST_WEBRTC_SDP_TYPE_OFFER, sdp);
        issue(backend, offer, "set-remote-description", description);gst_webrtc_session_description_free(description);return TRUE;
    }
    return FALSE;
}
gboolean audio_backend_prepare(AppContext* context, AudioBackend* output, DeviceType type, const char* device_id, const WebRtcOptions* options, gboolean sender) {
    if (type != DEVICE_TYPE_WEBRTC) return sender ? create_audio_source(type, device_id, output) : create_audio_sink(type, device_id, output);
    GError* error = NULL;
    const char* description = sender ?
        "webrtcbin name=webrtc bundle-policy=max-bundle queue name=input ! rtpopusdepay ! opusdec ! audioconvert ! audioresample ! audio/x-raw,format=F32LE,rate=48000,channels=1 ! identity name=output" :
        "audioconvert name=input ! audioresample ! audio/x-raw,format=S16LE,rate=48000,channels=1 ! opusenc name=encoder bitrate=128000 dtx=false frame-size=20 ! rtpopuspay name=payloader ! capsfilter name=rtpcaps webrtcbin name=webrtc bundle-policy=max-bundle";
    GstElement* bin = gst_parse_bin_from_description(description, FALSE, &error);
    if (!bin || error) {
        g_printerr("Error: Could not construct WebRTC backend: %s\n", error ? error->message : "unknown failure");
        g_clear_error(&error);if (bin) gst_object_unref(bin);return FALSE;
    }
    WebRtcBackend* backend = g_new0(WebRtcBackend, 1);
    backend->references = 1;backend->active = TRUE;backend->context = context;backend->sender = sender;
    g_mutex_init(&backend->delivery_lock);
    backend->deliveries = g_async_queue_new_full(delivery_free);g_queue_init(&backend->candidates);
    backend->webrtc = gst_bin_get_by_name(GST_BIN(bin), "webrtc");backend->input = gst_bin_get_by_name(GST_BIN(bin), "input");
    backend->payloader = gst_bin_get_by_name(GST_BIN(bin), "payloader");backend->capsfilter = gst_bin_get_by_name(GST_BIN(bin), "rtpcaps");
    GstElement* edge = sender ? gst_bin_get_by_name(GST_BIN(bin), "output") : gst_object_ref(backend->input);
    GstPad* pad = gst_element_get_static_pad(edge, sender ? "src" : "sink");
    gst_element_add_pad(bin, gst_ghost_pad_new(sender ? "src" : "sink", pad));gst_object_unref(pad);gst_object_unref(edge);
    g_object_set(backend->webrtc, "latency", (guint)options->jitter_ms, NULL);
    GstWebRTCICE* ice = NULL;g_object_get(backend->webrtc, "ice-agent", &ice, NULL);
    if (ice && options->ice_min_port) g_object_set(ice, "min-rtp-port", (guint)options->ice_min_port, "max-rtp-port", (guint)options->ice_max_port, NULL);
    if (ice) gst_object_unref(ice);
    if (options->stun_server) g_object_set(backend->webrtc, "stun-server", options->stun_server, NULL);
    for (guint i = 0; i < options->turn_count; i++) {
        gboolean accepted = FALSE;g_signal_emit_by_name(backend->webrtc, "add-turn-server", options->turn_servers[i], &accepted);
        if (!accepted) {g_printerr("Error: Invalid TURN server configuration\n");release(backend);gst_object_unref(bin);return FALSE;}
    }
    if (!sender) {GstElement* encoder = gst_bin_get_by_name(GST_BIN(bin), "encoder");g_object_set(encoder, "bitrate", options->opus_bitrate, NULL);gst_object_unref(encoder);}
    g_signal_connect(backend->webrtc, "on-ice-candidate", G_CALLBACK(candidate_received), backend);
    g_signal_connect(backend->webrtc, "notify::ice-gathering-state", G_CALLBACK(gathering_changed), backend);
    g_signal_connect(backend->webrtc, "notify::connection-state", G_CALLBACK(connection_changed), backend);
    g_signal_connect(backend->webrtc, "pad-added", G_CALLBACK(pad_added), backend);
    backend->source = g_timeout_source_new(5);g_source_set_callback(backend->source, deliver, backend, NULL);g_source_attach(backend->source, g_main_loop_get_context(context->loop));
    context->webrtc = backend;
    if (!sender) audio_backend_watch_eos(context, backend->capsfilter, "src");
    memset(output, 0, sizeof(*output));output->elements[0] = bin;output->element_count = 1;
    return TRUE;
}
void audio_backend_quiesce(AppContext* context) {
    WebRtcBackend* backend = context->webrtc;
    if (!backend) return;
    g_mutex_lock(&backend->delivery_lock);backend->active = FALSE;g_mutex_unlock(&backend->delivery_lock);
    g_signal_handlers_disconnect_by_data(backend->webrtc, backend);
    if (backend->source) {g_source_destroy(backend->source);g_source_unref(backend->source);backend->source = NULL;}
    // Discard queued callbacks while the owner ref is still held; promise callbacks
    // retain the inactive backend and cannot reach the freed AppContext/control.
    Delivery* delivery;while ((delivery = g_async_queue_try_pop(backend->deliveries))) delivery_free(delivery);
}
void audio_backend_dispose(AppContext* context) {
    WebRtcBackend* backend = context->webrtc;
    if (!backend) return;
    audio_backend_quiesce(context);
    context->webrtc = NULL;
    if (backend->outgoing) {gst_element_release_request_pad(backend->webrtc, backend->outgoing);gst_object_unref(backend->outgoing);}
    release(backend);
}
static void drain_audio_async(GstElement* element, gpointer data) {
    (void)data;
    // Each mixer input needs an independent dispatch: a streaming thread can
    // hold one source's stream lock while waiting for the other input.
    GST_INFO_OBJECT(element, "Dispatching audio EOS");
    gst_element_send_event(element, gst_event_new_eos());
    GST_INFO_OBJECT(element, "Audio EOS dispatched");
}
gboolean audio_backend_stop(AppContext* context) {
    WebRtcBackend* backend = context->webrtc;
    if (!backend) return FALSE;
    if (!backend->remote_set) {
        // No negotiated media pads exist yet; there is no stream to drain or
        // recording-finalized event to certify. Cancel preparation normally.
        g_main_loop_quit(context->loop);return TRUE;
    }
    // Never send pipeline-wide EOS into NiceSrc: it is the encrypted transport,
    // not an experimental audio source. Drain only the ordinary audio branches.
    if (backend->sender) {
        GstPad* sink = gst_element_get_static_pad(backend->input, "sink");
        gst_pad_send_event(sink, gst_event_new_eos());gst_object_unref(sink);
    }
    else {
        const char* names[] = {"udpsrc-peer", "udpsrc-echo", "udpsrc-record"};
        for (guint i = 0; i < G_N_ELEMENTS(names); i++) {
            GstElement* source = gst_bin_get_by_name(GST_BIN(context->pipeline), names[i]);
            if (source) {gst_element_call_async(source, drain_audio_async, NULL, NULL);gst_object_unref(source);}
        }
    }
    return TRUE;
}
static GstPadProbeReturn branch_eos(GstPad* pad, GstPadProbeInfo* info, gpointer data) {
    (void)pad;AppContext* context = data;
    if (GST_EVENT_TYPE(GST_PAD_PROBE_INFO_EVENT(info)) == GST_EVENT_EOS) {
        gst_element_post_message(context->pipeline, gst_message_new_application(GST_OBJECT(context->pipeline), gst_structure_new_empty("est-branch-eos")));
        return GST_PAD_PROBE_REMOVE;
    }
    return GST_PAD_PROBE_OK;
}
void audio_backend_watch_eos(AppContext* context, GstElement* element, const char* pad_name) {
    GstPad* pad = gst_element_get_static_pad(element, pad_name);
    context->eos_branches++;
    gst_pad_add_probe(pad, GST_PAD_PROBE_TYPE_EVENT_DOWNSTREAM, branch_eos, context, NULL);gst_object_unref(pad);
}
