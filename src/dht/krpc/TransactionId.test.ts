import { describe, expect, it } from 'bun:test';

import {
    KRPC_TRANSACTION_ID_LENGTH,
    KRPC_TRANSACTION_ID_SPACE,
    KrpcTransactionIdGenerator,
    krpcTransactionKey,
} from './TransactionId';

describe('KrpcTransactionIdGenerator', () => {
    it('creates 2-byte transaction ids', () => {
        const generator = new KrpcTransactionIdGenerator();

        expect(generator.create()).toHaveLength(KRPC_TRANSACTION_ID_LENGTH);
    });

    it('increments transaction ids as big-endian uint16 values', () => {
        const generator = new KrpcTransactionIdGenerator();

        expect([...generator.create()]).toEqual([0x00, 0x00]);
        expect([...generator.create()]).toEqual([0x00, 0x01]);
        expect([...generator.create()]).toEqual([0x00, 0x02]);
    });

    it('accepts an initial counter value', () => {
        const generator = new KrpcTransactionIdGenerator({ initialValue: 0x1234 });

        expect([...generator.create()]).toEqual([0x12, 0x34]);
        expect([...generator.create()]).toEqual([0x12, 0x35]);
    });

    it('wraps after the uint16 transaction id space', () => {
        const generator = new KrpcTransactionIdGenerator({
            initialValue: KRPC_TRANSACTION_ID_SPACE - 1,
        });

        expect([...generator.create()]).toEqual([0xff, 0xff]);
        expect([...generator.create()]).toEqual([0x00, 0x00]);
    });

    it('normalizes invalid initial values', () => {
        expect([...new KrpcTransactionIdGenerator({ initialValue: -1 }).create()]).toEqual([
            0xff, 0xff,
        ]);
        expect([...new KrpcTransactionIdGenerator({ initialValue: 1.9 }).create()]).toEqual([
            0x00, 0x01,
        ]);
        expect([...new KrpcTransactionIdGenerator({ initialValue: Number.NaN }).create()]).toEqual([
            0x00, 0x00,
        ]);
    });
});

describe('krpcTransactionKey', () => {
    it('creates a stable hex map key from a transaction id', () => {
        expect(krpcTransactionKey(new Uint8Array([0x00, 0x0f]))).toBe('000f');
        expect(krpcTransactionKey(new Uint8Array([0xab, 0xcd]))).toBe('abcd');
    });
});
