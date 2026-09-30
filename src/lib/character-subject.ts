export function characterReferenceAnimalSpecies(prompt: string | null | undefined): string | null {
    const source = prompt?.toLowerCase() ?? ''
    const species: Array<[RegExp, string]> = [
        [/(?:\blioness\b|雌狮)/i, 'lioness'],
        [/(?:\bmale lion\b|雄狮)/i, 'male lion'],
        [/(?:\blion\b|狮子|狮王)/i, 'lion'],
        [/(?:\btiger\b|猛虎|老虎)/i, 'tiger'],
        [/(?:\bleopard\b|豹子)/i, 'leopard'],
        [/(?:\bcheetah\b|猎豹)/i, 'cheetah'],
        [/(?:\bhyena\b|鬣狗)/i, 'hyena'],
        [/(?:\bwarthog\b|疣猪)/i, 'warthog'],
        [/(?:\bsquirrel\b|松鼠)/i, 'squirrel'],
        [/(?:\bwolf\b|灰狼|狼王|狼)/i, 'wolf'],
        [/(?:\bfox\b|狐狸)/i, 'fox'],
        [/(?:\bbear\b|棕熊|黑熊|白熊|熊)/i, 'bear'],
        [/(?:\brabbit\b|\bhare\b|兔子|兔)/i, 'rabbit'],
        [/(?:\bdog\b|\bhound\b|\bcanine\b|犬|狗)/i, 'dog'],
        [/(?:\bcat\b|\bfeline\b|猫)/i, 'cat'],
        [/(?:\bhorse\b|马)/i, 'horse'],
        [/(?:\bdeer\b|鹿)/i, 'deer'],
        [/(?:\bsnake\b|\bserpent\b|\bcobra\b|\bpython\b|毒蛇|眼镜蛇|蟒蛇|蛇)/i, 'snake'],
        [/(?:\bscorpion\b|巨蝎|毒蝎|蝎子|蝎)/i, 'scorpion'],
        [/(?:\bspider\b|蜘蛛)/i, 'spider'],
        [/(?:\bdolphin\b|海豚)/i, 'dolphin'],
        [/(?:\bwhale\b|鲸)/i, 'whale'],
        [/(?:\bturtle\b|海龟|乌龟)/i, 'turtle'],
        [/(?:\bdinosaur\b|恐龙)/i, 'dinosaur'],
        [/(?:\bhornbill\b|犀鸟)/i, 'hornbill'],
        [/(?:\bmeerkat\b|狐獴)/i, 'meerkat'],
        [/(?:\bbird\b|\bavian\b|鸟)/i, 'bird'],
        [/(?:\banimal\b|动物)/i, 'animal']
    ]
    return species.find(([pattern]) => pattern.test(source))?.[1] ?? null
}
