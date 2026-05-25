export type UdpSocket = {
    send(data: Uint8Array, port: number, host: string): boolean | void | Promise<boolean | void>;
    close(): void;
    ref?(): void;
    unref?(): void;
};

export type UdpSocketHandlers = {
    data(socket: UdpSocket, data: Uint8Array): void;
    error(socket: UdpSocket, error: unknown): void;
};

export type CreateUdpSocket = (handlers: UdpSocketHandlers) => UdpSocket | Promise<UdpSocket>;

export const createUdpSocket = async (handlers: UdpSocketHandlers): Promise<UdpSocket> => {
    const wrappedRef: { current?: UdpSocket } = {};
    const socket = await Bun.udpSocket({
        socket: {
            data(_socket, data) {
                handlers.data(getWrappedSocket(wrappedRef), new Uint8Array(data));
            },
            error(_socket, error) {
                handlers.error(getWrappedSocket(wrappedRef), error);
            },
        },
    });

    const wrapped: UdpSocket = {
        send: socket.send.bind(socket),
        close() {
            socket.close();
            socket.unref();
        },
        ref: socket.ref.bind(socket),
        unref: socket.unref.bind(socket),
    };
    wrappedRef.current = wrapped;

    return wrapped;
};

const getWrappedSocket = (wrappedRef: { current?: UdpSocket }): UdpSocket => {
    if (!wrappedRef.current) {
        throw new Error('UDP socket is not ready');
    }

    return wrappedRef.current;
};
