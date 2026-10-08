import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── LA BASE GÉOGRAPHIQUE EST DOUBLÉE, PAS LE RESTE ──────────────────────────
// `countryMapFor` est jugé AVEC ses vrais collaborateurs (`countryAliases` pour
// la normalisation, `locationMaps` pour le cadrage) : ce qui est remplacé est
// seulement la SOURCE des bornes, pour que le test puisse présenter une base
// corrompue sans dépendre de ce que le backend sert un jour. Doubler les
// collaborateurs testerait le test.
const base = { getDatabase: vi.fn() };
vi.mock('../../services/geolocation-database', () => ({
  getDatabase: () => base.getDatabase(),
}));

const { countryMapFor } = await import('../countryMap');

// Les bornes du Sénégal telles que `kojo_geo_data.py` les publie (et telles que
// le repli compact de `services/geolocation-database.js` les recopie à
// l'identique) : le test déclare sa donnée, il ne la lit pas dans le code jugé.
const SENEGAL = { north: 16.6917, south: 12.3075, east: -11.3557, west: -17.5354 };

const baseAvec = (pays) => {
  base.getDatabase.mockReturnValue(pays);
};

describe('carte du pays — la règle, pure', () => {
  beforeEach(() => {
    base.getDatabase.mockReset();
  });

  it('cadre le pays déclaré, et donne l’embed ET la page du MÊME cadre', () => {
    baseAvec({ senegal: { nameFrench: 'Sénégal', country: 'Senegal', bounds: SENEGAL } });

    expect(countryMapFor('senegal')).toEqual({
      src: 'https://www.openstreetmap.org/export/embed.html?bbox=-17.5354%2C12.3075%2C-11.3557%2C16.6917&layer=mapnik',
      href: 'https://www.openstreetmap.org/?bbox=-17.5354%2C12.3075%2C-11.3557%2C16.6917',
      nom: 'Sénégal',
    });
  });

  it('accepte le code ISO comme le code long (même cadre, pas deux tables)', () => {
    const donnees = { senegal: { nameFrench: 'Sénégal', bounds: SENEGAL } };
    baseAvec(donnees);

    expect(countryMapFor('SN')).toEqual(countryMapFor('senegal'));
  });

  it('trouve la Côte d’Ivoire sous le nom que la base lui donne (`cote_divoire`)', () => {
    baseAvec({
      cote_divoire: {
        nameFrench: 'Côte d’Ivoire',
        bounds: { north: 10.7402, south: 4.3571, east: -2.4947, west: -8.6024 },
      },
    });

    expect(countryMapFor('ivory_coast')?.nom).toBe('Côte d’Ivoire');
    expect(countryMapFor('CI')).toEqual(countryMapFor('ivory_coast'));
  });

  it('ne cadre RIEN pour un pays hors des quatre couverts — un bloc vide vaut moins que pas de bloc', () => {
    baseAvec({ senegal: { bounds: SENEGAL } });

    expect(countryMapFor('atlantide')).toBeNull();
  });

  it('ne cadre rien sans code de pays, ni sur une base vide', () => {
    baseAvec({});

    expect(countryMapFor('')).toBeNull();
    expect(countryMapFor(undefined)).toBeNull();
    expect(countryMapFor(null)).toBeNull();
  });

  it('refuse un pays sans bornes publiées', () => {
    baseAvec({ senegal: { nameFrench: 'Sénégal' } });

    expect(countryMapFor('senegal')).toBeNull();
  });

  it('refuse un cadre INVERSÉ (bornes croisées) : une carte vide qui prétend montrer quelque chose', () => {
    baseAvec({ senegal: { bounds: { ...SENEGAL, north: 10, south: 20 } } });
    expect(countryMapFor('senegal')).toBeNull();

    baseAvec({ senegal: { bounds: { ...SENEGAL, east: -30, west: 4 } } });
    expect(countryMapFor('senegal')).toBeNull();
  });

  it('refuse un cadre d’aire NULLE (bornes confondues)', () => {
    baseAvec({ senegal: { bounds: { north: 14, south: 14, east: -17, west: -17 } } });

    expect(countryMapFor('senegal')).toBeNull();
  });

  it('refuse des bornes qui ne sont pas des nombres', () => {
    baseAvec({ senegal: { bounds: { ...SENEGAL, north: 'nord' } } });

    expect(countryMapFor('senegal')).toBeNull();
  });

  it('retombe sur le nom anglais quand la base n’a pas de nom français', () => {
    baseAvec({ mali: { country: 'Mali', bounds: SENEGAL } });

    expect(countryMapFor('mali')?.nom).toBe('Mali');
  });
});
