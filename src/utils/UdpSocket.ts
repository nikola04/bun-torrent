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
    let wrapped!: UdpSocket;
    const socket = await Bun.udpSocket({
        socket: {
            data(_socket, data) {
                handlers.data(wrapped, new Uint8Array(data));
            },
            error(_socket, error) {
                handlers.error(wrapped, error);
            },
        },
    });

    wrapped = {
        send: socket.send.bind(socket),
        close() {
            socket.close();
            socket.unref();
        },
        ref: socket.ref.bind(socket),
        unref: socket.unref.bind(socket),
    };

    return wrapped;
};
