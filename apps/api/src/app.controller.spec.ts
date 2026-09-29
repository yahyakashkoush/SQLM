import { AppController } from './app.controller';

describe('AppController', () => {
  let controller: AppController;

  beforeEach(() => {
    controller = new AppController();
  });

  it('returns service status ok', () => {
    const result = controller.info();
    expect(result.status).toBe('ok');
    expect(result.name).toContain('SQLM');
  });
});
