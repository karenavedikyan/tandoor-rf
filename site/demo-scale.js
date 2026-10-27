/* Aggregate counts verified by read-only LK requests on 2026-10-15.
 * Every record and assignment below is synthetic. No production identifiers or PII.
 * Raw holdings are not the same entity as grouped visible clients.
 */
window.buildTandoorDemoScale = function ({ clients, outlets, legals }) {
  const shape = window.tandoorDemoTeamShape;
  const totals = Object.freeze({
    clients: 2206, legalEntities: 2743, retailOutlets: 3773,
    orphanOutlets: 1550, employees: shape.rosterCount, rawHoldings: 2383,
    rops: shape.teams.length, additionalResponsibles: shape.externalCount
  });
  const aliases = new Map(shape.teams.map(t => [t.head, t.id]));
  [['E1','DEMO-DIRECTOR'],['E5','DEMO-M1'],['E7','DEMO-R1'],
    ['E21','DEMO-HW1'],['E6','DEMO-M2']].forEach(([key,id]) => aliases.set(key,id));
  const named = { 'DEMO-ROP1':'Елена Волкова', 'DEMO-ROP2':'Дмитрий Орлов',
    'DEMO-M1':'Алексей Морозов', 'DEMO-M2':'Павел Лебедев',
    'DEMO-R1':'Игорь Соколов', 'DEMO-HW1':'Максим Савельев', 'DEMO-DIRECTOR':'Андрей Власов' };
  const tokens = [
    ...Array.from({length: shape.rosterCount}, (_,i) => `E${i+1}`),
    ...Array.from({length: shape.externalCount}, (_,i) => `X${i+1}`)
  ];
  const people = tokens.map(token => {
    const id = aliases.get(token) || `DEMO-${token}`;
    const ownHead = shape.teams.find(t => t.head === token);
    const memberships = shape.teams.filter(t => t.rows.some(r => r[0] === token)).map(t => t.id);
    const kinds = [...new Set(shape.teams.flatMap(t => t.rows.filter(r => r[0] === token).map(r => r[1])))];
    if (ownHead) { memberships.push(ownHead.id); kinds.unshift('rop'); }
    if (id === 'DEMO-DIRECTOR') kinds.push('director');
    const inRoster = token.startsWith('E');
    return { id, name: named[id] || (ownHead ? `Руководитель ${ownHead.id.replace('DEMO-ROP','').padStart(2,'0')}` :
      `${inRoster ? 'Сотрудник' : 'Ответственный вне ОПТ'} ${token.slice(1).padStart(2,'0')}`),
      team: ownHead?.id || memberships[0] || null, teams: [...new Set(memberships)],
      kinds: kinds.length ? kinds : ['employee'], inRoster, account: inRoster };
  });
  const byToken = new Map(tokens.map((token,i) => [token, people[i]]));
  const teams = shape.teams.map(t => ({
    ...t, head: byToken.get(t.head),
    members: [...new Set(t.rows.map(r => r[0]))].map(token => byToken.get(token))
  }));
  const cities = ['Краснодар', 'Армавир', 'Майкоп', 'Ростов-на-Дону', 'Сочи', 'Новороссийск',
    'Ставрополь', 'Анапа', 'Таганрог', 'Волгодонск', 'Тихорецк', 'Геленджик'];
  const names = ['Дверной квартал', 'Южный дом', 'Линия интерьера', 'Дом и стиль',
    'Галерея дверей', 'Новый формат', 'Мастерская пространства', 'Двери и фурнитура'];
  const assign = (row, scope, kind, person) => {
    row[`${scope}_${kind}Id`] = person?.id || null;
    row[`${scope}_${kind}`] = person?.name || null;
  };
  const assignments = (row, scope, index) => {
    let local = index;
    const countKey = scope === 'client' ? 'clients' : 'outlets';
    const team = teams.find(t => { if (local < t[countKey]) return true; local -= t[countKey]; return false; });
    for (const kind of ['manager','regional','hardware']) {
      const options = team?.rows.filter(r => r[1] === kind && r[scope === 'client' ? 2 : 3] > 0) || [];
      // Model varied portfolios, preserving team sizes and empty responsibility cases.
      // Per-person client assignment sets are synthetic, not a copy of LK.
      const person = options.length ? byToken.get(options[local % options.length][0]) : null;
      assign(row, scope, kind, person);
    }
    assign(row, scope, 'rop', team?.head);
  };
  const scaledClients = Array.from({ length: totals.clients }, (_, i) => {
    const seed = clients[i % clients.length];
    const id = `DEMO-C${i + 1}`, city = cities[Math.floor(i / teams.length) % cities.length];
    const name = i < clients.length ? seed.clientName :
      `${names[i % names.length]} · ${String(i + 1).padStart(4, '0')}`;
    const row = { ...seed, id, clientId: id, clientName: name,
      holdingId: `DEMO-H${i + 1}`, holdingName: `Демо-группа «${name}»`, isHolding: true,
      clientAddress: `${city}, Учебная улица, ${i % 180 + 1}`,
      clientPhones: 'Демо-телефон клиента',
      topCategory: ['ТОП-150', 'ТОП-350', 'ТОП-500', null][Math.floor(i / 7) % 4],
      discountAmount: i % 9 === 0 ? 0 : i % 12, markupPercentage: i % 5
    };
    assignments(row, 'client', i);
    return row;
  });
  const linkedTotal = totals.retailOutlets - totals.orphanOutlets;
  const outletsByClient = new Map(scaledClients.map(c => [c.id, []]));
  const scaledOutlets = Array.from({ length: totals.retailOutlets }, (_, i) => {
    const orphan = i >= linkedTotal;
    const parent = orphan ? null : scaledClients[i % scaledClients.length];
    const seed = outlets[i % outlets.length];
    const id = `DEMO-T${String(i + 1).padStart(4, '0')}`;
    const row = { ...seed, ...parent, id, outletId: id,
      clientId: parent?.id || null,
      clientName: parent?.clientName || `ТТ без холдинга · ${String(i - linkedTotal + 1).padStart(4, '0')}`,
      holdingId: parent?.holdingId || null, holdingName: parent?.holdingName || null,
      outletHolding: parent?.holdingName || null, isHolding: false,
      clientAddress: parent?.clientAddress || null, clientPhones: parent?.clientPhones || null,
      topCategory: parent?.topCategory || null,
      discountProgram: parent?.discountProgram || null, discountAmount: parent?.discountAmount ?? null,
      markupName: parent?.markupName || null, markupPercentage: parent?.markupPercentage ?? null,
      storeAddress: `${cities[Math.floor(i / teams.length) % cities.length]}, Демонстрационная улица, ${i % 250 + 1}`,
      deliveryAddress: i % 7 ? `${cities[Math.floor(i / teams.length) % cities.length]}, Демо-склад №${i % 90 + 1}` : null,
      route: cities[Math.floor(i / teams.length) % cities.length], closed: i % 23 === 0, warehouse: i % 5 === 0,
      monday: i * 17 % totals.retailOutlets < 640, tuesday: i * 19 % totals.retailOutlets < 900,
      wednesday: i * 23 % totals.retailOutlets < 1250, thursday: i * 29 % totals.retailOutlets < 950,
      friday: i * 31 % totals.retailOutlets < 361, saturday: i * 37 % totals.retailOutlets < 450,
      sunday: i * 41 % totals.retailOutlets < 75,
      loadingTime: ['09:00', '10:00', '14:30', null][i % 4],
      lprName: i % 5 ? `Демо-контакт ${i + 1}` : null,
      lprEmail: i % 5 ? `demo-contact-${i + 1}@example.test` : null,
      accountantEmail: i % 4 ? `demo-accounts-${i + 1}@example.test` : null,
      club: ['Gold', 'Silver', null, 'Platinum'][i % 4], clubBonus: i % 5 === 0 ? '0' : null
    };
    for (const kind of ['manager', 'regional', 'hardware', 'rop']) assign(row, 'client', kind,
      parent ? people.find(e => e.id === parent[`client_${kind}Id`]) : null);
    assignments(row, 'outlet', i);
    if (parent) outletsByClient.get(parent.id).push(id);
    return row;
  });
  const scaledLegals = Array.from({ length: totals.legalEntities }, (_, i) => {
    const parent = scaledClients[i % scaledClients.length];
    const seed = legals[i % legals.length];
    return { ...seed, clientId: parent.id, legalId: `DEMO-L${i + 1}`,
      legalName: `ООО «${parent.clientName}${i >= scaledClients.length ? ' Сервис' : ''}»`,
      inn: `ДЕМО-ИНН-${String(i + 1).padStart(5, '0')}`, kpp: `ДЕМО-КПП-${i + 1}`,
      legalAddress: `${cities[i % cities.length]}, Макетная улица, ${i % 150 + 1}`,
      bik: `ДЕМО-БИК-${i + 1}`, account: `ДЕМО-РС-${i + 1}`, corrAccount: `ДЕМО-КС-${i + 1}`,
      outletIds: [...outletsByClient.get(parent.id)],
      contracts: [{ ...seed.contracts[0], contractId: `DEMO-D${i + 1}`,
        contractNumber: `ДЕМО-2026/${String(i + 1).padStart(5, '0')}`,
        contractStatus: i % 9 ? 'Действующий' : 'Архивный',
        deferDays: [0, 7, 14, 30][i % 4], creditLimit: i % 13 === 0 ? 0 : (i % 8 + 1) * 100000 }]
    };
  });
  return { clients: scaledClients, outlets: scaledOutlets, legals: scaledLegals, employees: people, teams, totals };
};
