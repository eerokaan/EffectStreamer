#ifndef EST_WEBRTC_H
#define EST_WEBRTC_H
#include "effectstreamer.h"
#include "control/control.h"
gboolean audio_backend_prepare(AppContext* context, AudioBackend* backend, DeviceType type, const char* device_id, const WebRtcOptions* options, gboolean sender);
gboolean audio_backend_handle_control(AppContext* context, const char* command, const cJSON* id, const cJSON* payload);
gboolean audio_backend_stop(AppContext* context);
void audio_backend_watch_eos(AppContext* context, GstElement* element, const char* pad_name);
void audio_backend_dispose(AppContext* context);
void audio_backend_quiesce(AppContext* context);
#endif
