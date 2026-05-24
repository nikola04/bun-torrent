export type UdpSocket = {
    send(data: Uint8Array, port: number, host: string): boolean | void | Promise<boolean | void>;
    close(): void;
};

export type UdpSocketHandlers = {
    data(socket: UdpSocket, data: Uint8Array): void;
    error(socket: UdpSocket, error: unknown): void;
};

export type CreateUdpSocket = (handlers: UdpSocketHandlers) => UdpSocket | Promise<UdpSocket>;

export const createUdpSocket = async (handlers: UdpSocketHandlers): Promise<UdpSocket> => {
    const socket = await Bun.udpSocket({
        socket: {
            data(socket, data) {
                handlers.data(socket, new Uint8Array(data));
            },
            error(socket, error) {
                handlers.error(socket, error);
            },
        },
    });

    return socket;
};
