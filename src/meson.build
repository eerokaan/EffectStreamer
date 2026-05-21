cdata = configuration_data()
cdata.set_quoted('PACKAGE_VERSION', meson.project_version())
cdata.set_quoted('PACKAGE', 'estnetsim')
cdata.set_quoted('GST_LICENSE', 'AGPL-3.0')
cdata.set_quoted('GST_PACKAGE_NAME', 'EffectStreamer NetSim')
cdata.set_quoted('GST_PACKAGE_ORIGIN', 'https://git.tu-berlin.de/qu/speech-quality/effectstreamer')
configure_file(output : 'config.h', configuration : cdata)

shared_library('estnetsim',
    ['estnetsim.c'],
    c_args : ['-DHAVE_CONFIG_H'],
    dependencies : [gst_dep],
    install : true,
    install_dir : plugins_install_dir,
)
