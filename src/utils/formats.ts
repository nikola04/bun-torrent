const byteUnits = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
export const formatBytes = (bytes: number): string => {
    const i = bytes === 0 ? 0 : Math.floor(Math.log(bytes) / Math.log(1024));
    const value = Number(bytes / Math.pow(1024, i)).toFixed(1);

    if (i >= byteUnits.length) return `${bytes} B`;
    return `${value} ${byteUnits[i]}`;
};
