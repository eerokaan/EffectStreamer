module.exports = {
    server: {
        host: "127.0.0.1",
        port: "3000"
    },
    conditions: {
        baseline: [
            {latency: "20", gain: "1.0"}
        ],
        random: [
            // Corners (extremes of both dimensions)
            {latency: "40",  gain: "0.2"},
            {latency: "160", gain: "0.2"},
            {latency: "40",  gain: "1.0"},
            {latency: "160", gain: "1.0"},

            // Center (mid latency, mid gain levels)
            {latency: "100", gain: "0.45"},
            {latency: "100", gain: "0.7"},
            
            // Spread (off-center, covering remaining quadrants)
            {latency: "60",  gain: "0.7"},
            {latency: "140", gain: "0.45"},
            {latency: "80",  gain: "1.0"},
            {latency: "120", gain: "0.2"},
        ]
    }
};