import { describe, it, expect } from 'vitest';
import {
  stripJobMarkerFromMessage,
  getJobMarker,
  hasCurrentUserAppliedToJob,
  getCurrentUserProposal,
  extractProposalId,
  extractProposalWorkerId,
} from '../jobProposalWorkflow';

describe('stripJobMarkerFromMessage', () => {
  it('retire un ancien marqueur [KOJO_JOB:xxx] du texte', () => {
    const input = '[KOJO_JOB:abc-123] Bonjour, je suis disponible.';
    expect(stripJobMarkerFromMessage(input)).toBe('Bonjour, je suis disponible.');
  });

  it('ne modifie pas un message sans marqueur', () => {
    const input = 'Bonjour, je suis disponible.';
    expect(stripJobMarkerFromMessage(input)).toBe(input);
  });

  it('gère un contenu vide ou nul sans planter', () => {
    expect(stripJobMarkerFromMessage('')).toBe('');
    expect(stripJobMarkerFromMessage(null)).toBe('');
    expect(stripJobMarkerFromMessage(undefined)).toBe('');
  });

  it('retire le marqueur même au milieu du texte', () => {
    const input = 'Salut [KOJO_JOB:xyz] comment vas-tu ?';
    expect(stripJobMarkerFromMessage(input)).toBe('Salut comment vas-tu ?');
  });
});

describe('getJobMarker', () => {
  it('génère un marqueur au format attendu', () => {
    expect(getJobMarker('abc-123')).toBe('[KOJO_JOB:abc-123]');
  });

  it('retourne une chaîne vide si jobId est vide', () => {
    expect(getJobMarker('')).toBe('');
    expect(getJobMarker(null)).toBe('');
  });
});

describe('hasCurrentUserAppliedToJob', () => {
  const currentUser = { id: 'worker-1' };

  it('retourne true si le worker a une proposition sur ce job', () => {
    const proposals = [
      { id: 'p1', job_id: 'job-1', worker_id: 'worker-1' },
      { id: 'p2', job_id: 'job-2', worker_id: 'worker-2' },
    ];
    expect(hasCurrentUserAppliedToJob('job-1', proposals, currentUser)).toBe(true);
  });

  it('retourne false si aucune proposition ne correspond', () => {
    const proposals = [
      { id: 'p1', job_id: 'job-2', worker_id: 'worker-2' },
    ];
    expect(hasCurrentUserAppliedToJob('job-1', proposals, currentUser)).toBe(false);
  });

  it('gère une liste de propositions vide', () => {
    expect(hasCurrentUserAppliedToJob('job-1', [], currentUser)).toBe(false);
  });

  it('gère currentUser absent sans planter', () => {
    expect(hasCurrentUserAppliedToJob('job-1', [], null)).toBe(false);
  });
});

describe('getCurrentUserProposal', () => {
  const currentUser = { id: 'worker-1' };

  it('retrouve la proposition du worker courant parmi plusieurs', () => {
    const proposals = [
      { id: 'p1', worker_id: 'worker-2' },
      { id: 'p2', worker_id: 'worker-1' },
    ];
    const result = getCurrentUserProposal(proposals, currentUser);
    expect(result?.id).toBe('p2');
  });

  it('retourne undefined si aucune proposition ne correspond', () => {
    const proposals = [{ id: 'p1', worker_id: 'worker-2' }];
    expect(getCurrentUserProposal(proposals, currentUser)).toBeFalsy();
  });
});

describe('extractProposalId / extractProposalWorkerId', () => {
  it('extrait id et worker_id malgré des formats de champ différents', () => {
    const proposal = { id: 'p1', worker_id: 'w1' };
    expect(extractProposalId(proposal)).toBe('p1');
    expect(extractProposalWorkerId(proposal)).toBe('w1');
  });

  it('gère un objet vide sans planter', () => {
    expect(extractProposalId({})).toBeFalsy();
    expect(extractProposalWorkerId({})).toBeFalsy();
  });
});
