// Workday regression cases mirrored in Editor and Back Publisher.
export const workdayFormulaCases = [
    {
        name: 'addWorkdays',
        code: 'wwFormulas.addWorkdays("2024-05-24T12:30:00Z", 1, "2024-05-27")',
        expected: '2024-05-28T12:30:00.000Z',
    },
    {
        name: 'workdayDiff',
        code: 'wwFormulas.workdayDiff("2020-10-16", "2020-11-02", "2020-10-16,2020-10-19")',
        expected: 10,
    },
    {
        name: 'workday backwards',
        code: 'wwFormulas.addWorkdays("2024-05-28", -1, ["2024-05-27"])',
        expected: '2024-05-24T00:00:00.000Z',
    },
    {
        name: 'workday zero weekend',
        code: 'wwFormulas.addWorkdays("2024-05-25", 0)',
        expected: '2024-05-25T00:00:00.000Z',
    },
    { name: 'workday leap day', code: 'wwFormulas.addWorkdays("2024-02-28", 2)', expected: '2024-03-01T00:00:00.000Z' },
    { name: 'workday diff weekend', code: 'wwFormulas.workdayDiff("2024-05-25", "2024-05-26")', expected: 0 },
    { name: 'workday diff inclusive', code: 'wwFormulas.workdayDiff("2024-05-24", "2024-05-24")', expected: 1 },
    {
        name: 'workday diff reversed',
        code: 'wwFormulas.workdayDiff("2024-05-28", "2024-05-24", ["2024-05-27", "2024-05-27"])',
        expected: -2,
    },
    { name: 'workday full weeks', code: 'wwFormulas.workdayDiff("2024-05-20", "2024-06-02")', expected: 10 },
];
