/*
 * EffectStreamer Core
 * @company Quality and Usability Lab | TU Berlin
 * @author  Eero Kaan <eerokaan@qu.tu-berlin.de>
 */

#include <errno.h>
#include <getopt.h>
#include <limits.h>
#include <math.h>
#include "effectstreamer.h"

enum {
    OPTION_PEERIP = 1 << 0,
    OPTION_NATIVE_DELAY = 1 << 1,
    OPTION_ECHO_DELAY = 1 << 2,
    OPTION_NATIVE_GAIN = 1 << 3,
    OPTION_ECHO_GAIN = 1 << 4,
    OPTION_PACKETLOSS_TYPE = 1 << 5,
    OPTION_PACKETLOSS_RATIO = 1 << 6,
    OPTION_PACKETLOSS_SEED = 1 << 7,
    OPTION_PACKETLOSS_BURST_MODEL = 1 << 8,
    OPTION_PACKETLOSS_BURST_RATIO = 1 << 9,
    OPTION_PEER_PORT = 1 << 10,
    OPTION_LISTEN_PORT = 1 << 11,
    OPTION_BIND_ADDRESS = 1 << 12,
    SENDER_OPTIONS = OPTION_PEERIP | OPTION_NATIVE_DELAY | OPTION_ECHO_DELAY | OPTION_PACKETLOSS_TYPE |
                     OPTION_PACKETLOSS_RATIO | OPTION_PACKETLOSS_SEED | OPTION_PACKETLOSS_BURST_MODEL |
                      OPTION_PACKETLOSS_BURST_RATIO | OPTION_PEER_PORT,
    RECEIVER_OPTIONS = OPTION_NATIVE_GAIN | OPTION_ECHO_GAIN | OPTION_LISTEN_PORT | OPTION_BIND_ADDRESS,
};

static void print_usage(const char* prog_name) {
    // clang-format off
    fprintf(stderr, "\nEffectStreamer Core\n");
    fprintf(stderr, "Platform: %s\n\n", get_platform_name());

    fprintf(stderr, "Usage (Sender mode):\n");
    fprintf(stderr, "  %s --mode sender --device-type <alsa|wasapi2|stdio> [--device-id <DEVICE-ID>] --peerip <IP-ADDRESS> [--native-delay <MS>] [--echo-delay <MS>] [--packetloss-type <none|random|bursty>] [--packetloss-ratio <0.0-1.0>] [--packetloss-seed <INT>] [--packetloss-burst-model <g107-markov>] [--packetloss-burst-ratio <1.0-8.0>] [--help]\n\n", prog_name);

    fprintf(stderr, "Usage (Receiver mode):\n");
    fprintf(stderr, "  %s --mode receiver --device-type <alsa|wasapi2|stdio> [--device-id <DEVICE-ID>] [--native-gain <GAIN>] [--echo-gain <GAIN>] [--help]\n\n", prog_name);

    fprintf(stderr, "Options:\n");
    fprintf(stderr, "  --mode                    Mode of operation: 'sender' or 'receiver'\n");
    fprintf(stderr, "  --device-type             Required backend: 'alsa', 'wasapi2', or 'stdio'\n");
    fprintf(stderr, "  --device-id               Optional ALSA/WASAPI2 backend device ID; invalid with stdio\n");
    fprintf(stderr, "  --peerip                  IP address of the peer receiver (sender mode only)\n");
    fprintf(stderr, "  --peer-port               Peer receiver port (sender only, default: 9004)\n");
    fprintf(stderr, "  --listen-port             Peer input port (receiver only, default: 9004)\n");
    fprintf(stderr, "  --echo-port               Local echo port (default: 9005)\n");
    fprintf(stderr, "  --record-port             Local microphone recording port (default: 9006)\n");
    fprintf(stderr, "  --bind-address            Input bind address (receiver only, default: 0.0.0.0)\n");
    fprintf(stderr, "  --control                 none (default), or ndjson for managed native audio; incompatible with stdio\n");
    fprintf(stderr, "  --native-delay            Additional native queue delay in milliseconds (sender mode only, default: 0)\n");
    fprintf(stderr, "  --native-gain             Native gain from 0.0 to 1.0 (receiver mode only, default: 1.0)\n");
    fprintf(stderr, "  --echo-delay              Additional echo queue delay in milliseconds (sender mode only, default: 0)\n");
    fprintf(stderr, "  --echo-gain               Echo gain from 0.0 to 1.0 (receiver mode only, default: 0.0)\n");
    fprintf(stderr, "  --packetloss-type         Packet loss type: 'none', 'random', or 'bursty' (sender mode only, default: none)\n");
    fprintf(stderr, "  --packetloss-ratio        Packet loss ratio from 0.0 to 1.0 (sender mode only, default: 0.0)\n");
    fprintf(stderr, "  --packetloss-seed         Packet loss seed; 0 chooses a random seed per stream (sender mode only, default: 0)\n");
    fprintf(stderr, "  --packetloss-burst-model  Packet loss burst model: 'g107-markov' (sender mode only, default: g107-markov)\n");
    fprintf(stderr, "  --packetloss-burst-ratio  Packet loss burst ratio from 1.0 to 8.0 (sender mode only, default: 1.0)\n");
    fprintf(stderr, "  --help                    Show this help message\n\n");
    // clang-format on
}

static gboolean parse_int_option(const char* value, const char* option_name, int* out) {
    char* endptr;
    long parsed;

    errno = 0;
    parsed = strtol(value, &endptr, 10);
    if (value[0] == '\0' || g_ascii_isspace(value[0]) || errno == ERANGE || endptr == value || *endptr != '\0' ||
        parsed < 0 || parsed > INT_MAX) {
        fprintf(stderr, "Error: Invalid value for %s: '%s' (expected 0 to %d)\n", option_name, value, INT_MAX);
        return FALSE;
    }

    *out = (int)parsed;
    return TRUE;
}

static gboolean parse_double_option(const char* value, const char* option_name, double min, double max, double* out) {
    char* endptr;
    double parsed;

    errno = 0;
    parsed = strtod(value, &endptr);
    if (value[0] == '\0' || g_ascii_isspace(value[0]) || errno == ERANGE || endptr == value || *endptr != '\0' ||
        !isfinite(parsed) || parsed < min || parsed > max) {
        fprintf(stderr, "Error: Invalid value for %s: '%s' (expected %.1f to %.1f)\n", option_name, value, min, max);
        return FALSE;
    }

    *out = parsed;
    return TRUE;
}

static gboolean parse_uint_option(const char* value, const char* option_name, guint* out) {
    char* endptr;
    unsigned long parsed;

    errno = 0;
    parsed = strtoul(value, &endptr, 10);
    if (value[0] == '\0' || value[0] == '-' || g_ascii_isspace(value[0]) || errno == ERANGE || endptr == value ||
        *endptr != '\0' || parsed > G_MAXUINT) {
        fprintf(stderr, "Error: Invalid value for %s: '%s' (expected 0 to %u)\n", option_name, value, G_MAXUINT);
        return FALSE;
    }

    *out = (guint)parsed;
    return TRUE;
}

static DeviceType parse_device_type(const char* value) {
    if (strcmp(value, "alsa") == 0) return DEVICE_TYPE_ALSA;
    if (strcmp(value, "wasapi2") == 0) return DEVICE_TYPE_WASAPI2;
    if (strcmp(value, "stdio") == 0) return DEVICE_TYPE_STDIO;
    return DEVICE_TYPE_UNKNOWN;
}

static gboolean parse_port(const char* value, const char* name, int* out) {
    if (!parse_int_option(value, name, out)) return FALSE;
    if (*out < 1 || *out > 65535) {
        fprintf(stderr, "Error: Invalid value for %s: expected 1 to 65535\n", name);
        return FALSE;
    }
    return TRUE;
}

static gboolean is_valid_packetloss_type(const char* value) {
    return strcmp(value, "none") == 0 || strcmp(value, "random") == 0 || strcmp(value, "bursty") == 0;
}

static gboolean is_valid_packetloss_burst_model(const char* value) {
    return strcmp(value, "g107-markov") == 0;
}

static const char* get_first_option_name(guint supplied_options) {
    if (supplied_options & OPTION_PEER_PORT) return "--peer-port";
    if (supplied_options & OPTION_LISTEN_PORT) return "--listen-port";
    if (supplied_options & OPTION_BIND_ADDRESS) return "--bind-address";
    if (supplied_options & OPTION_PEERIP) return "--peerip";
    if (supplied_options & OPTION_NATIVE_DELAY) return "--native-delay";
    if (supplied_options & OPTION_ECHO_DELAY) return "--echo-delay";
    if (supplied_options & OPTION_NATIVE_GAIN) return "--native-gain";
    if (supplied_options & OPTION_ECHO_GAIN) return "--echo-gain";
    if (supplied_options & OPTION_PACKETLOSS_TYPE) return "--packetloss-type";
    if (supplied_options & OPTION_PACKETLOSS_RATIO) return "--packetloss-ratio";
    if (supplied_options & OPTION_PACKETLOSS_SEED) return "--packetloss-seed";
    if (supplied_options & OPTION_PACKETLOSS_BURST_MODEL) return "--packetloss-burst-model";
    if (supplied_options & OPTION_PACKETLOSS_BURST_RATIO) return "--packetloss-burst-ratio";
    return "unknown option";
}

int main(int argc, char* argv[]) {
    // CLI option storage and defaults
    int option_code;
    int exit_code;
    GError* init_error = NULL;

    guint supplied_options = 0;
    gboolean help_requested = FALSE;

    char* mode = NULL;
    char* device_type = NULL;
    char* device_id = NULL;
    char* device_id_auto_detected = NULL;
    const char* peerip = NULL;
    int peer_port = 9004, listen_port = 9004, echo_port = 9005, record_port = 9006;
    const char* bind_address = "0.0.0.0";
    gboolean managed = FALSE;
    
    DeviceType device_type_parsed;

    int nativedelay = 0;
    double nativegain = 1.0;

    int echodelay = 0;
    double echogain = 0.0;
    
    const char* packetloss_type = "none";
    double packetloss_ratio = 0.0;
    guint packetloss_seed = 0;
    const char* packetloss_burst_model = "g107-markov";
    double packetloss_burst_ratio = 1.0;

    enum {
        OPT_MODE = 1,
        OPT_DEVICE_TYPE,
        OPT_DEVICE_ID,
        OPT_PEERIP,
        OPT_PEER_PORT,
        OPT_LISTEN_PORT,
        OPT_ECHO_PORT,
        OPT_RECORD_PORT,
        OPT_BIND_ADDRESS,
        OPT_CONTROL,
        OPT_NATIVEDELAY,
        OPT_ECHODELAY,
        OPT_NATIVEGAIN,
        OPT_ECHOGAIN,
        OPT_PACKETLOSS_TYPE,
        OPT_PACKETLOSS_RATIO,
        OPT_PACKETLOSS_SEED,
        OPT_PACKETLOSS_BURST_MODEL,
        OPT_PACKETLOSS_BURST_RATIO,
        OPT_HELP
    };

    // getopt_long option table
    // clang-format off
    static struct option long_options[] = {
        {"mode", required_argument, 0, OPT_MODE},
        {"device-type", required_argument, 0, OPT_DEVICE_TYPE},
        {"device-id", required_argument, 0, OPT_DEVICE_ID},
        {"peerip", required_argument, 0, OPT_PEERIP},
        {"peer-port", required_argument, 0, OPT_PEER_PORT},
        {"listen-port", required_argument, 0, OPT_LISTEN_PORT},
        {"echo-port", required_argument, 0, OPT_ECHO_PORT},
        {"record-port", required_argument, 0, OPT_RECORD_PORT},
        {"bind-address", required_argument, 0, OPT_BIND_ADDRESS},
        {"control", required_argument, 0, OPT_CONTROL},
        {"native-delay", required_argument, 0, OPT_NATIVEDELAY},
        {"echo-delay", required_argument, 0, OPT_ECHODELAY},
        {"native-gain", required_argument, 0, OPT_NATIVEGAIN},
        {"echo-gain", required_argument, 0, OPT_ECHOGAIN},
        {"packetloss-type", required_argument, 0, OPT_PACKETLOSS_TYPE},
        {"packetloss-ratio", required_argument, 0, OPT_PACKETLOSS_RATIO},
        {"packetloss-seed", required_argument, 0, OPT_PACKETLOSS_SEED},
        {"packetloss-burst-model", required_argument, 0, OPT_PACKETLOSS_BURST_MODEL},
        {"packetloss-burst-ratio", required_argument, 0, OPT_PACKETLOSS_BURST_RATIO},
        {"help", no_argument, 0, OPT_HELP},
        {0, 0, 0, 0}
    };
    // clang-format on

    // Parse command-line arguments
    opterr = 0;
    while ((option_code = getopt_long(argc, argv, "", long_options, NULL)) != -1) {
        switch (option_code) {
            case OPT_CONTROL:
                if (strcmp(optarg, "none") && strcmp(optarg, "ndjson")) {
                    fprintf(stderr, "Error: Invalid --control (expected none or ndjson)\n"); return 1;
                }
                managed = !strcmp(optarg, "ndjson");
                break;
            case OPT_PEER_PORT:
                supplied_options |= OPTION_PEER_PORT;
                if (!parse_port(optarg, "--peer-port", &peer_port)) return 1;
                break;
            case OPT_LISTEN_PORT:
                supplied_options |= OPTION_LISTEN_PORT;
                if (!parse_port(optarg, "--listen-port", &listen_port)) return 1;
                break;
            case OPT_ECHO_PORT:
                if (!parse_port(optarg, "--echo-port", &echo_port)) return 1;
                break;
            case OPT_RECORD_PORT:
                if (!parse_port(optarg, "--record-port", &record_port)) return 1;
                break;
            case OPT_BIND_ADDRESS:
                supplied_options |= OPTION_BIND_ADDRESS;
                if (!g_hostname_is_ip_address(optarg)) {
                    fprintf(stderr, "Error: Invalid --bind-address\n"); return 1;
                }
                bind_address = optarg;
                break;
            case OPT_MODE:
                mode = optarg;
                break;
            case OPT_DEVICE_TYPE:
                device_type = optarg;
                break;
            case OPT_DEVICE_ID:
                device_id = optarg;
                break;
            case OPT_PEERIP:
                supplied_options |= OPTION_PEERIP;
                peerip = optarg;
                break;
            case OPT_NATIVEDELAY:
                supplied_options |= OPTION_NATIVE_DELAY;
                if (!parse_int_option(optarg, "--native-delay", &nativedelay)) return 1;
                break;
            case OPT_ECHODELAY:
                supplied_options |= OPTION_ECHO_DELAY;
                if (!parse_int_option(optarg, "--echo-delay", &echodelay)) return 1;
                break;
            case OPT_NATIVEGAIN:
                supplied_options |= OPTION_NATIVE_GAIN;
                if (!parse_double_option(optarg, "--native-gain", 0.0, 1.0, &nativegain)) return 1;
                break;
            case OPT_ECHOGAIN:
                supplied_options |= OPTION_ECHO_GAIN;
                if (!parse_double_option(optarg, "--echo-gain", 0.0, 1.0, &echogain)) return 1;
                break;
            case OPT_PACKETLOSS_TYPE:
                supplied_options |= OPTION_PACKETLOSS_TYPE;
                if (!is_valid_packetloss_type(optarg)) {
                    fprintf(stderr, "Error: Invalid --packetloss-type '%s' (expected none, random, or bursty)\n", optarg);
                    return 1;
                }
                packetloss_type = optarg;
                break;
            case OPT_PACKETLOSS_RATIO:
                supplied_options |= OPTION_PACKETLOSS_RATIO;
                if (!parse_double_option(optarg, "--packetloss-ratio", 0.0, 1.0, &packetloss_ratio)) return 1;
                break;
            case OPT_PACKETLOSS_SEED:
                supplied_options |= OPTION_PACKETLOSS_SEED;
                if (!parse_uint_option(optarg, "--packetloss-seed", &packetloss_seed)) return 1;
                break;
            case OPT_PACKETLOSS_BURST_MODEL:
                supplied_options |= OPTION_PACKETLOSS_BURST_MODEL;
                if (!is_valid_packetloss_burst_model(optarg)) {
                    fprintf(stderr, "Error: Invalid --packetloss-burst-model '%s' (expected g107-markov)\n", optarg);
                    return 1;
                }
                packetloss_burst_model = optarg;
                break;
            case OPT_PACKETLOSS_BURST_RATIO:
                supplied_options |= OPTION_PACKETLOSS_BURST_RATIO;
                if (!parse_double_option(optarg, "--packetloss-burst-ratio", 1.0, 8.0, &packetloss_burst_ratio)) return 1;
                break;
            case OPT_HELP:
                help_requested = TRUE;
                break;
            default:
                fprintf(stderr, "Error: Unknown or malformed option\n");
                print_usage(argv[0]);
                return 1;
        }
    }

    // Validate parsed arguments: Broad checks
    if (optind != argc) {
        fprintf(stderr, "Error: Unexpected positional argument '%s'\n", argv[optind]);
        print_usage(argv[0]);
        return 1;
    }
    if (help_requested) {
        print_usage(argv[0]);
        return 0;
    }
    if (!mode) {
        fprintf(stderr, "Error: --mode parameter is required\n");
        print_usage(argv[0]);
        return 1;
    }
    if (!is_sender_mode(mode) && !is_receiver_mode(mode)) {
        fprintf(stderr, "Error: Invalid mode '%s' (expected sender or receiver)\n", mode);
        print_usage(argv[0]);
        return 1;
    }

    // Validate parsed arguments: Device I
    if (!device_type) {
        fprintf(stderr, "Error: --device-type parameter is required\n");
        print_usage(argv[0]);
        return 1;
    }

    device_type_parsed = parse_device_type(device_type);

    if (device_type_parsed == DEVICE_TYPE_UNKNOWN) {
        fprintf(stderr, "Error: Invalid --device-type '%s' (expected alsa, wasapi2, or stdio)\n", device_type);
        print_usage(argv[0]);
        return 1;
    }
    if (!is_device_type_supported(device_type_parsed)) {
        fprintf(stderr,
                "Error: Device type '%s' is not supported on %s (expected %s)\n",
                device_type,
                get_platform_name(),
                get_supported_device_type_names());
        return 1;
    }
    if (device_id && device_id[0] == '\0') {
        fprintf(stderr, "Error: --device-id must not be empty\n");
        return 1;
    }
    if (device_type_parsed == DEVICE_TYPE_STDIO && device_id) {
        fprintf(stderr, "Error: --device-id is invalid with --device-type stdio\n");
        return 1;
    }

    // Validate parsed arguments: Sender/Receiver
    if (managed && device_type_parsed == DEVICE_TYPE_STDIO) {
        fprintf(stderr, "Error: NDJSON control is incompatible with stdio PCM\n"); return 1;
    }
    if (is_sender_mode(mode) && (supplied_options & RECEIVER_OPTIONS)) {
        fprintf(stderr,
                "Error: %s is only supported in receiver mode\n",
                get_first_option_name(supplied_options & RECEIVER_OPTIONS));
        return 1;
    }
    if (is_receiver_mode(mode) && (supplied_options & SENDER_OPTIONS)) {
        fprintf(stderr,
                "Error: %s is only supported in sender mode\n",
                get_first_option_name(supplied_options & SENDER_OPTIONS));
        return 1;
    }
    if (is_sender_mode(mode) && (!peerip || peerip[0] == '\0')) {
        fprintf(stderr, "Error: --peerip is required and must not be empty in sender mode\n");
        return 1;
    }
    if (is_sender_mode(mode) && strcmp(packetloss_type, "none") == 0 && packetloss_ratio > 0.0) {
        fprintf(stderr, "Error: --packetloss-ratio requires --packetloss-type random or bursty\n");
        return 1;
    }

    // Validate parsed arguments: Device II
    if (device_type_parsed == DEVICE_TYPE_STDIO && !set_stdio_binary_mode(mode)) {
        fprintf(stderr, "Error: Could not set stdio to binary mode\n");
        return 1;
    }

    // Validate parsed arguments: GStreamer
    if (!gst_init_check(NULL, NULL, &init_error)) {
        fprintf(
            stderr, "Error: Could not initialize GStreamer: %s\n", init_error ? init_error->message : "unknown error");
        g_clear_error(&init_error);
        return 1;
    }

    // Validate parsed arguments: Device III
    if (device_type_parsed != DEVICE_TYPE_STDIO && !device_id) {
        device_id_auto_detected = get_first_audio_device(device_type_parsed, mode);

        if (!device_id_auto_detected) {
            fprintf(stderr,
                    "Error: Could not auto-detect a %s audio %s\n",
                    get_device_type_name(device_type_parsed),
                    is_sender_mode(mode) ? "source" : "sink");
            gst_deinit();
            return 1;
        }
        
        device_id = device_id_auto_detected;
        g_printerr("Auto-detected %s audio %s: %s\n",
                   get_device_type_name(device_type_parsed),
                   is_sender_mode(mode) ? "source" : "sink",
                   device_id);
    }

    // Build parameters and dispatch to sender/receiver
    // clang-format off
    if (is_sender_mode(mode)) {
        SenderParams params = {
            .device_type = device_type_parsed,
            .device_id = device_id,
            .peerip = peerip,
            .managed = managed,
            .peer_port = peer_port,
            .echo_port = echo_port,
            .record_port = record_port,
            .nativedelay = nativedelay,
            .echodelay = echodelay,
            .packetloss_type = packetloss_type,
            .packetloss_ratio = packetloss_ratio,
            .packetloss_seed = packetloss_seed,
            .packetloss_burst_model = packetloss_burst_model,
            .packetloss_burst_ratio = packetloss_burst_ratio
        };
        exit_code = run_sender(&params);
    } else {
        ReceiverParams params = {
            .device_type = device_type_parsed,
            .device_id = device_id,
            .nativegain = nativegain,
            .managed = managed,
            .echogain = echogain,
            .listen_port = listen_port,
            .echo_port = echo_port,
            .record_port = record_port,
            .bind_address = bind_address
        };
        exit_code = run_receiver(&params);
    }
    // clang-format on

    g_free(device_id_auto_detected);
    gst_deinit();

    return exit_code;
}
