import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types/user.types';
import { replayService } from '../services/replay.service';
import { Types } from 'mongoose';

function pid(req: AuthenticatedRequest) { return String(req.params['id']); }
function pbId(req: AuthenticatedRequest) { return String(req.params['bId']); }

export class BranchController {
  async list(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const branches = await replayService.listBranches(pid(req));
      res.json({ branches });
    } catch (err) { next(err); }
  }

  async create(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { name, fromSnapshotId } = req.body as any;
      const branch = await replayService.createBranch(pid(req), req.user!._id, name, fromSnapshotId);
      res.status(201).json({ branch });
    } catch (err) { next(err); }
  }

  async getEvents(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await replayService.getBranchEvents(pid(req), pbId(req), {
        from: req.query['from'] ? Number(req.query['from']) : undefined,
        limit: Number(req.query['limit'] ?? 100),
      });
      res.json(result);
    } catch (err) { next(err); }
  }

  async getSnapshot(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await replayService.getStateAtSequence(
        pid(req),
        pbId(req),
        Number(req.params['seqNo']),
      );
      res.json(result);
    } catch (err) { next(err); }
  }

  async merge(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await replayService.mergeBranch(
        pid(req),
        pbId(req),
        req.user!._id,
        req.body.strategy ?? 'append',
      );
      res.json(result);
    } catch (err) { next(err); }
  }
}

export const branchController = new BranchController();
