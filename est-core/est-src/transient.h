#ifndef EFFECTSTREAMER_TRANSIENT_H
#define EFFECTSTREAMER_TRANSIENT_H
#include <glib.h>
gchar* effectstreamer_executable_path(GError** error);
gboolean effectstreamer_transient_init(const gchar* executable_path, GError** error);
#endif
