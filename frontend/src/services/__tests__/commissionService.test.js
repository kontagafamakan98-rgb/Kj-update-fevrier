import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import CommissionService from '../commissionService';
import { paymentAPI } from '../api';

// Fragilité corrigée : COMMISSION_RATE=0.14 était codé en dur, alors que le
// backend expose le taux EFFECTIF (/payments/config → commission_rate_percent,
// modifiable en base db.settings type=commission). refreshCommissionRate()
// charge ce taux (cache) et calculateCommissions/getCommissionStats en
// dépendent — le backend recalcule toujours le vrai montant, ce taux ne sert
// qu'à l'affichage local et doit rester synchronisé.
describe('CommissionService — taux de commission effectif', () => {
  beforeEach(() => {
    // Repli sur le taux par défaut à chaque test + reset de la mémoïsation.
    CommissionService.COMMISSION_RATE = CommissionService.DEFAULT_COMMISSION_RATE;
    CommissionService.WORKER_RATE = 1 - CommissionService.DEFAULT_COMMISSION_RATE;
    CommissionService._ratePromise = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    CommissionService._ratePromise = null;
  });

  it('refreshCommissionRate charge le taux backend et met à jour le cache', async () => {
    vi.spyOn(paymentAPI, 'getConfig').mockResolvedValue({ commission_rate_percent: 20 });
    const rate = await CommissionService.refreshCommissionRate();
    expect(rate).toBeCloseTo(0.2);
    expect(CommissionService.COMMISSION_RATE).toBeCloseTo(0.2);
    expect(CommissionService.WORKER_RATE).toBeCloseTo(0.8);
  });

  it('calculateCommissions utilise le taux effectif chargé (async)', async () => {
    vi.spyOn(paymentAPI, 'getConfig').mockResolvedValue({ commission_rate_percent: 20 });
    const breakdown = await CommissionService.calculateCommissions(1000);
    expect(breakdown.ownerCommission).toBe(200);
    expect(breakdown.workerAmount).toBe(800);
    expect(breakdown.commissionRate).toBe(20);
  });

  it('défaut 14% si le backend est indisponible (fallback sûr)', async () => {
    vi.spyOn(paymentAPI, 'getConfig').mockRejectedValue(new Error('réseau down'));
    const breakdown = await CommissionService.calculateCommissions(1000);
    expect(breakdown.ownerCommission).toBe(140);
    expect(breakdown.workerAmount).toBe(860);
    expect(breakdown.commissionRate).toBe(14);
  });

  it('taux backend invalide (hors 0-50) → garde le taux courant', async () => {
    vi.spyOn(paymentAPI, 'getConfig').mockResolvedValue({ commission_rate_percent: 99 });
    await CommissionService.refreshCommissionRate();
    expect(CommissionService.COMMISSION_RATE).toBeCloseTo(0.14);
  });

  it('mémoïsation : un seul fetch pour plusieurs calculs successifs', async () => {
    const spy = vi.spyOn(paymentAPI, 'getConfig').mockResolvedValue({ commission_rate_percent: 20 });
    await CommissionService.calculateCommissions(1000);
    await CommissionService.calculateCommissions(2000);
    await CommissionService.calculateCommissions(3000);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
