/*
 * EffectStreamer Core
 * @company Quality and Usability Lab | TU Berlin
 * @author  Eero Kaan <eerokaan@qu.tu-berlin.de>
 */

#ifndef EFFECTSTREAMER_H
#define EFFECTSTREAMER_H

/* Platform constants */
#if defined(_WIN32)
#define PLATFORM_WINDOWS 1
#define PLATFORM_LINUX 0
#ifndef _WIN32_WINNT
#define _WIN32_WINNT 0x0600
#endif
#elif defined(__linux__)
#define PLATFORM_WINDOWS 0
#define PLATFORM_LINUX 1
#else
#error "EffectStreamer Core supports only Windows and Linux"
#endif

#include <gst/gst.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* Common structures */
typedef struct CoreControl CoreControl;
typedef struct WebRtcBackend WebRtcBackend;
typedef struct {
    GMainLoop* loop;
    GstElement* pipeline;
    gboolean runtime_error;
    GMutex error_lock;
    CoreControl* control;
    GstElement* gate;
    GstElement* preparation_volume;
    gint started;
    gboolean stopping;
    gboolean eos_received;
    guint stop_timeout;
    gint media_reported;
    WebRtcBackend* webrtc;
    guint eos_branches;
    guint eos_branches_finished;
} AppContext;

typedef enum {
    DEVICE_TYPE_UNKNOWN = 0,
    DEVICE_TYPE_ALSA,
    DEVICE_TYPE_WASAPI2,
    DEVICE_TYPE_STDIO,
    DEVICE_TYPE_WEBRTC,
} DeviceType;

typedef struct {
    int ice_min_port;
    int ice_max_port;
    int jitter_ms;
    int opus_bitrate;
    const char* stun_server;
    const char* turn_servers[8];
    guint turn_count;
} WebRtcOptions;

typedef struct {
    GstElement* elements[3];
    guint element_count;
} AudioBackend;

/* Sender parameters */
typedef struct {
    DeviceType device_type;
    const char* device_id;
    const char* peerip;
    gboolean managed;
    gboolean recording;
    const char* recording_dir;
    int peer_port;
    int echo_port;
    int record_port;
    int rtp_frames;
    int nativedelay;
    int echodelay;
    const char* packetloss_type;
    double packetloss_ratio;
    guint packetloss_seed;
    const char* packetloss_burst_model;
    double packetloss_burst_ratio;
    WebRtcOptions webrtc;
} SenderParams;

/* Receiver parameters */
typedef struct {
    DeviceType device_type;
    const char* device_id;
    double nativegain;
    gboolean managed;
    gboolean recording;
    const char* recording_dir;
    double echogain;
    int listen_port;
    int echo_port;
    int record_port;
    const char* bind_address;
    WebRtcOptions webrtc;
} ReceiverParams;

/* Function declarations */
const char* get_platform_name(void);
gboolean is_sender_mode(const char* mode);
gboolean is_receiver_mode(const char* mode);
const char* get_device_type_name(DeviceType device_type);
const char* get_supported_device_type_names(void);
gboolean is_device_type_supported(DeviceType device_type);
gboolean set_stdio_binary_mode(const char* mode);
GstElement* create_element(const char* factory_name, const char* element_name);
GstElement* create_and_add_element(GstBin* bin, const char* factory_name, const char* element_name);
char* get_first_audio_device(DeviceType device_type, const char* mode);
gboolean create_audio_source(DeviceType device_type, const char* device_id, AudioBackend* backend);
gboolean create_audio_sink(DeviceType device_type, const char* device_id, AudioBackend* backend);
gboolean add_audio_backend(GstBin* bin, AudioBackend* backend);
GstElement* get_audio_backend_first(AudioBackend* backend);
GstElement* get_audio_backend_last(AudioBackend* backend);
int run_sender(SenderParams* params);
int run_receiver(ReceiverParams* params);

#endif
