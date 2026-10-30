class PortAllocator {
    constructor([first, last]) {
        if (!Number.isInteger(first) || !Number.isInteger(last) || first < 1024 || last > 65535 || first > last) throw new Error("Invalid media port range");
        this.first = first; this.last = last; this.leases = new Map();
    }
    lease(owner, count) {
        if (!owner || !Number.isInteger(count) || count < 1) throw new Error("Invalid port lease");
        if (this.leases.has(owner)) {
            const existing = this.leases.get(owner);
            if (existing.length !== count) throw new Error("Lease size cannot change");
            return [...existing];
        }
        const used = new Set([...this.leases.values()].flat()), ports = [];
        for (let port = this.first; port <= this.last && ports.length < count; port++) if (!used.has(port)) ports.push(port);
        if (ports.length !== count) throw new Error("Media port capacity exhausted");
        this.leases.set(owner, ports); return [...ports];
    }
    release(owner) { this.leases.delete(owner); }
}
module.exports = { PortAllocator };
