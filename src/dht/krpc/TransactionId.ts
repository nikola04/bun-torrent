import { bytesToHex } from '../../utils/buffers';
import type { KrpcTransactionId } from './types';

export const KRPC_TRANSACTION_ID_LENGTH = 2;
export const KRPC_TRANSACTION_ID_SPACE = 0x10000;

export type KrpcTransactionIdGeneratorOptions = {
    initialValue?: number;
};

export class KrpcTransactionIdGenerator {
    private next: number;

    constructor(options: KrpcTransactionIdGeneratorOptions = {}) {
        this.next = normalizeCounter(options.initialValue ?? 0);
    }

    public create(): KrpcTransactionId {
        const id = new Uint8Array(KRPC_TRANSACTION_ID_LENGTH);
        id[0] = this.next >> 8;
        id[1] = this.next & 0xff;

        this.next = normalizeCounter(this.next + 1);

        return id;
    }
}

export const krpcTransactionKey = (transactionId: KrpcTransactionId): string =>
    bytesToHex(transactionId);

const normalizeCounter = (value: number): number => {
    if (!Number.isFinite(value)) return 0;

    return Math.trunc(value) & 0xffff;
};
