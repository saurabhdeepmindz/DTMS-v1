/** Where a project's WeWeb backend runs, its server and its database alike: those this deployment offers. */
export type BackendRegion = {
    icon: string;
    label: string;
    value: string;
    lat: number;
    lng: number;
    disabled?: boolean;
    disabledTooltip?: string;
};

export const DEFAULT_BACKEND_REGION = 'us-east-1';

const REGIONS: BackendRegion[] = [
    {
        icon: 'logos/flag-united-states',
        label: 'US East (N. Virginia)',
        value: 'us-east-1',
        lat: 38.7466,
        lng: -77.4477,
    },
    {
        icon: 'logos/flag-united-states',
        label: 'US East (Ohio)',
        value: 'us-east-2',
        lat: 40.4173,
        lng: -82.9071,
    },
    {
        icon: 'logos/flag-united-states',
        label: 'US West (Oregon)',
        value: 'us-west-2',
        lat: 44.0682,
        lng: -120.5933,
    },
    {
        icon: 'logos/flag-germany',
        label: 'Europe Central (Frankfurt)',
        value: 'eu-central-1',
        lat: 50.1109,
        lng: 8.6821,
    },
    {
        icon: 'logos/flag-united-kingdom',
        label: 'Europe West (London)',
        value: 'eu-west-2',
        lat: 51.5074,
        lng: -0.1278,
    },
    {
        icon: 'logos/flag-singapore',
        label: 'Asian Pacific (Singapore)',
        value: 'ap-southeast-1',
        lat: 1.3521,
        lng: 103.8198,
    },
    {
        icon: 'logos/flag-australia',
        label: 'Asian Pacific (Sydney)',
        value: 'ap-southeast-2',
        lat: -33.8688,
        lng: 151.2093,
    },
    {
        icon: 'logos/flag-brazil',
        label: 'South America East (São Paulo)',
        value: 'sa-east-1',
        lat: -23.5505,
        lng: -46.6333,
    },
];

export function getBackendRegions(): BackendRegion[] {
    const availableRegions = import.meta.env.VITE_APP_AVAILABLE_REGIONS;
    const isProduction = import.meta.env.VITE_APP_ENV_MODE === 'production';
    return (
        REGIONS.filter(region => availableRegions.includes(region.value))
            // Outside production, only the US region can be picked: the others show, greyed out.
            .map(region =>
                isProduction || region.value.startsWith('us-')
                    ? region
                    : {
                          ...region,
                          disabled: true,
                          disabledTooltip: 'Only the US region is available outside production.',
                      }
            )
    );
}
