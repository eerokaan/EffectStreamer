#ifndef EST_WAV_H
#define EST_WAV_H
#include "effectstreamer.h"
gboolean wav_recording_add(GstElement* pipeline, GstElement* playback_tee, const char* directory, const char* address, int port);
#endif
