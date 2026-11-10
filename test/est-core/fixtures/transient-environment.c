#include "transient.h"
#include <glib.h>
int main(int argc, char** argv) {
    GError* error=NULL;
    gchar* executable=effectstreamer_executable_path(&error);
    if(!executable || !effectstreamer_transient_init(executable,&error)) {g_printerr("%s\n",error?error->message:"transient failure");g_clear_error(&error);g_free(executable);return 1;}
    g_print("{\"tmp\":\"%s\",\"cache\":\"%s\",\"registry\":\"%s\"}\n",g_getenv("TMPDIR"),g_getenv("XDG_CACHE_HOME"),g_getenv("GST_REGISTRY"));
    if(argc>1){gint status;gboolean ok=g_spawn_sync(NULL,argv+1,NULL,G_SPAWN_SEARCH_PATH,NULL,NULL,NULL,NULL,&status,&error);if(!ok || !g_spawn_check_wait_status(status,&error)){g_printerr("%s\n",error?error->message:"probe failure");g_clear_error(&error);g_free(executable);return 1;}}
    g_free(executable);return 0;
}
