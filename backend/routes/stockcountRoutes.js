import express from 'express';
import { stockcountAuth, stockcountRequestLogger } from '../middleware/stockcountAuth.js';
import {
  getStockcountItem,
  getStockcountItemStock,
  listStockcountItems,
  stockcountHealth
} from '../services/stockcountService.js';

const router = express.Router();

router.use(stockcountRequestLogger);
router.use(stockcountAuth);

router.get('/health', (_req, res) => {
  res.json({ success: true, ...stockcountHealth() });
});

router.get('/items', async (req, res, next) => {
  try {
    const result = await listStockcountItems(req.query || {});
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
});

router.get('/items/:itemId', async (req, res, next) => {
  try {
    const item = await getStockcountItem(req.params.itemId);
    if (!item) {
      res.status(404).json({ success: false, message: 'Item was not found.', code: 'STOCKCOUNT_ITEM_NOT_FOUND' });
      return;
    }
    res.json({ success: true, data: item, readAt: item.readAt });
  } catch (error) {
    next(error);
  }
});

router.get('/items/:itemId/stock', async (req, res, next) => {
  try {
    const item = await getStockcountItemStock(req.params.itemId);
    if (!item) {
      res.status(404).json({ success: false, message: 'Item was not found.', code: 'STOCKCOUNT_ITEM_NOT_FOUND' });
      return;
    }
    res.json({ success: true, data: item, readAt: item.readAt });
  } catch (error) {
    next(error);
  }
});

export default router;
