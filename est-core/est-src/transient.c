#include "transient.h"
#include <errno.h>
#include <stdlib.h>
#include <glib/gstdio.h>
#ifdef G_OS_WIN32
#include <windows.h>
#else
#include <unistd.h>
#include <sys/stat.h>
#endif

gchar* effectstreamer_executable_path(GError** error) {
#ifdef G_OS_WIN32
    WCHAR buffer[32768];
    DWORD length=GetModuleFileNameW(NULL,buffer,G_N_ELEMENTS(buffer));
    if(!length || length>=G_N_ELEMENTS(buffer)) {
        g_set_error_literal(error,G_FILE_ERROR,G_FILE_ERROR_FAILED,"Cannot resolve the native executable path");return NULL;
    }
    return g_utf16_to_utf8((const gunichar2*)buffer,length,NULL,NULL,error);
#else
    return g_file_read_link("/proc/self/exe",error);
#endif
}
static gboolean private_directory(const gchar* directory, gboolean shared_root, GError** error) {
    if(g_mkdir(directory,0700)!=0 && errno!=EEXIST) {
        g_set_error(error,G_FILE_ERROR,g_file_error_from_errno(errno),"Cannot create transient directory %s: %s",directory,g_strerror(errno));return FALSE;
    }
#ifdef G_OS_WIN32
    (void)shared_root;
    g_autofree gunichar2* name=g_utf8_to_utf16(directory,-1,NULL,NULL,error);
    if(!name)return FALSE;
    DWORD attributes=GetFileAttributesW((const WCHAR*)name);
    if(attributes==INVALID_FILE_ATTRIBUTES || !(attributes&FILE_ATTRIBUTE_DIRECTORY) || (attributes&FILE_ATTRIBUTE_REPARSE_POINT)) {
        g_set_error(error,G_FILE_ERROR,G_FILE_ERROR_FAILED,"Unsafe transient directory: %s",directory);return FALSE;
    }
#else
    struct stat info;
    if(g_lstat(directory,&info)!=0) {
        g_set_error(error,G_FILE_ERROR,g_file_error_from_errno(errno),"Cannot inspect transient directory: %s",directory);return FALSE;
    }
    gboolean admin_root=shared_root && info.st_uid==0 && (info.st_mode&S_ISVTX);
    if(!S_ISDIR(info.st_mode) || S_ISLNK(info.st_mode) || (!admin_root && (info.st_uid!=getuid() || (info.st_mode&0022)))) {
        g_set_error(error,G_FILE_ERROR,G_FILE_ERROR_FAILED,"Unsafe transient directory ownership/permissions: %s",directory);return FALSE;
    }
#endif
    return TRUE;
}
static gboolean ensure_tree(const gchar* root, const gchar* directory, GError** error) {
    if(!private_directory(root,TRUE,error))return FALSE;
    g_auto(GStrv) parts=g_strsplit(directory+strlen(root)+1,G_DIR_SEPARATOR_S,-1);
    gchar* current=g_strdup(root);
    for(guint i=0;parts[i];i++) {
        gchar* next=g_build_filename(current,parts[i],NULL);g_free(current);current=next;
        if(!private_directory(current,FALSE,error)){g_free(current);return FALSE;}
    }
    g_free(current);return TRUE;
}
gboolean effectstreamer_transient_init(const gchar* executable_path, GError** error) {
    g_autofree gchar* parent=g_path_get_dirname(executable_path);
#ifdef G_OS_WIN32
    g_autofree gchar* anchor=g_canonicalize_filename(parent,NULL);
    g_autofree gchar* username_hash=g_compute_checksum_for_string(G_CHECKSUM_SHA256,g_get_user_name(),-1);
    g_autofree gchar* user=g_strdup_printf("user-%.16s",username_hash);
    const gchar* inherited=g_getenv("EST_TRANSIENT_ROOT");
    g_autofree gchar* root=inherited && g_path_is_absolute(inherited) ? g_strdup(inherited) : g_build_filename(g_get_tmp_dir(),"effectstreamer",NULL);
#else
    g_autofree gchar* anchor=realpath(parent,NULL);
    if(!anchor){g_set_error(error,G_FILE_ERROR,g_file_error_from_errno(errno),"Cannot resolve executable directory: %s",parent);return FALSE;}
    g_autofree gchar* user=g_strdup_printf("uid-%lu",(unsigned long)getuid());
    g_autofree gchar* root=g_strdup("/tmp/effectstreamer");
#endif
    g_autofree gchar* hash=g_compute_checksum_for_string(G_CHECKSUM_SHA256,anchor,-1);
    gchar key[17];memcpy(key,hash,16);key[16]='\0';
    g_autofree gchar* base=g_build_filename(root,user,key,"est-core",NULL);
    g_autofree gchar* runs=g_build_filename(base,"runs",NULL);
    g_autofree gchar* cache=g_build_filename(base,"cache",NULL);
    g_autofree gchar* gst=g_build_filename(cache,"gstreamer",NULL);
    if(!ensure_tree(root,runs,error) || !ensure_tree(root,gst,error))return FALSE;
    g_autofree gchar* run=g_build_filename(runs,"core-XXXXXX",NULL);
    if(!g_mkdtemp(run)){g_set_error(error,G_FILE_ERROR,g_file_error_from_errno(errno),"Cannot create core scratch: %s",g_strerror(errno));return FALSE;}
    g_autofree gchar* temporary=g_build_filename(run,"tmp",NULL);
    if(!private_directory(temporary,FALSE,error))return FALSE;
#ifdef G_OS_WIN32
    g_autofree gchar* registry=g_build_filename(gst,"registry-win32.bin",NULL);
#else
    g_autofree gchar* registry=g_build_filename(gst,"registry-linux.bin",NULL);
#endif
    g_setenv("TMPDIR",temporary,TRUE);g_setenv("TMP",temporary,TRUE);g_setenv("TEMP",temporary,TRUE);
    g_setenv("EST_TRANSIENT_ROOT",root,TRUE);g_setenv("XDG_CACHE_HOME",cache,TRUE);g_setenv("GST_REGISTRY",registry,TRUE);g_setenv("GST_REGISTRY_1_0",registry,TRUE);
    return TRUE;
}
