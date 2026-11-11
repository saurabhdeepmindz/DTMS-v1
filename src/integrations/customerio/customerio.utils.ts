import { TrackClient, APIClient, RegionUS, RegionEU } from 'customerio-node';

function getRegion(region: string) {
    return region === 'eu' ? RegionEU : RegionUS;
}

export function createTrackClient(connection: ConnectionConfig) {
    return new TrackClient(connection?.siteId, connection?.trackApiKey, { region: getRegion(connection?.region) });
}

export function createAPIClient(connection: ConnectionConfig) {
    return new APIClient(connection?.appApiKey, { region: getRegion(connection?.region) });
}
