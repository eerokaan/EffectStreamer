#ifndef EST_LIFECYCLE_H
#define EST_LIFECYCLE_H
#include "effectstreamer.h"
#include "control/control.h"
void lifecycle_prepare(AppContext* context, gboolean managed, GstElement* gate, GstElement* media_tap);
void lifecycle_bus(AppContext* context, GstMessage* message);
void lifecycle_eos(AppContext* context);
void lifecycle_finish(AppContext* context, gboolean success, gboolean recording);
#endif
