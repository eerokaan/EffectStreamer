#ifndef ECHOSTREAMER_H
#define ECHOSTREAMER_H

#include <gst/gst.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* Platform-specific includes */
#ifdef _WIN32
#include <windows.h>
#include <direct.h>
#define mkdir(path, mode) _mkdir(path)
#define sleep(x) Sleep((x) * 1000)
#else
#include <unistd.h>
#include <sys/stat.h>
#include <sys/types.h>
#endif

/* Common structures */
typedef struct
{
    GMainLoop *loop;
    GstElement *pipeline;
} AppContext;

/* Sender parameters */
typedef struct
{
    char *device;
    char *peerip;
    int echodelay;
} SenderParams;

/* Receiver parameters */
typedef struct
{
    char *device;
    double echogain;
} ReceiverParams;

/* Platform detection */
#ifdef _WIN32
#define PLATFORM_WINDOWS 1
#define AUDIO_SRC "wasapi2src"
#define AUDIO_SINK "wasapi2sink"
#else
#define PLATFORM_LINUX 1
#define AUDIO_SRC "alsasrc"
#define AUDIO_SINK "alsasink"
#endif

/* Function declarations */
const char *get_platform_name(void);
char *get_first_audio_device(gboolean is_source);
int run_sender(SenderParams *params);
int run_receiver(ReceiverParams *params);
void configure_audio_source(GstElement *src, const char *device);
void configure_audio_sink(GstElement *sink, const char *device);

#endif /* ECHOSTREAMER_H */
