import type { DhtNode } from './utils/compact';

export class KBucket {
    private readonly entries: DhtNode[] = [];

    constructor(private readonly capacity: number) {}

    public get size(): number {
        return this.entries.length;
    }

    public get nodes(): DhtNode[] {
        return this.entries.map(cloneNode);
    }

    public add(node: DhtNode): boolean {
        const existingIndex = this.entries.findIndex((entry) => sameNodeId(entry.id, node.id));

        if (existingIndex !== -1) {
            this.entries.splice(existingIndex, 1);
            this.entries.push(cloneNode(node));
            return true;
        }

        if (this.entries.length >= this.capacity) return false;

        this.entries.push(cloneNode(node));
        return true;
    }

    public remove(nodeId: Uint8Array): boolean {
        const index = this.entries.findIndex((entry) => sameNodeId(entry.id, nodeId));
        if (index === -1) return false;

        this.entries.splice(index, 1);
        return true;
    }

    public get(nodeId: Uint8Array): DhtNode | undefined {
        const node = this.entries.find((entry) => sameNodeId(entry.id, nodeId));
        return node ? cloneNode(node) : undefined;
    }
}

const sameNodeId = (left: Uint8Array, right: Uint8Array): boolean =>
    left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);

export const cloneNode = (node: DhtNode): DhtNode => ({
    id: node.id.slice(),
    host: node.host,
    port: node.port,
});
