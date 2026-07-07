/*
 * EffectStreamer Core
 * @company Quality and Usability Lab | TU Berlin
 * @author  Eero Kaan <eerokaan@qu.tu-berlin.de>
 */

#ifndef RECEIVERSTDIN_H
#define RECEIVERSTDIN_H

#include "effectstreamer.h"

typedef struct ReceiverStdinWatch ReceiverStdinWatch;

ReceiverStdinWatch* receiver_stdin_watch_start(AppContext* context);
void receiver_stdin_watch_stop(ReceiverStdinWatch* watch);
gboolean receiver_stdin_watch_had_error(ReceiverStdinWatch* watch);

#endif
