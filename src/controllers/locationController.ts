import type { Request, Response } from 'express';
import {
  listAddressesService,
  createAddressService,
  updateAddressService,
  deleteAddressService,
  setDefaultAddressService,
  checkServiceabilityService,
  type AddressInput,
} from '../services/locationService.js';
import { asyncHandler, requirePatientId, type AuthenticatedRequest } from '../middlewares/auth.js';

export const listAddressesHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const addresses = await listAddressesService(requirePatientId(req));
  res.status(200).json({ success: true, addresses });
});

export const createAddressHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const address = await createAddressService(requirePatientId(req), req.body as AddressInput);
  res.status(201).json({ success: true, address });
});

export const updateAddressHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const address = await updateAddressService(
    requirePatientId(req),
    (req.params as { id: string }).id,
    req.body as Partial<AddressInput>
  );
  res.status(200).json({ success: true, address });
});

export const deleteAddressHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const result = await deleteAddressService(
    requirePatientId(req),
    (req.params as { id: string }).id
  );
  res.status(200).json({ success: true, ...result });
});

export const setDefaultAddressHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const address = await setDefaultAddressService(
      requirePatientId(req),
      (req.params as { id: string }).id
    );
    res.status(200).json({ success: true, address });
  }
);

/**
 * Open to any signed-in user rather than patients only: someone has to be able
 * to check whether we deliver to an area before they have a patient profile.
 */
export const checkServiceabilityHandler = asyncHandler(async (req: Request, res: Response) => {
  const { pincode } = req.query as { pincode: string };
  const result = await checkServiceabilityService(pincode);
  res.status(200).json({ success: true, ...result });
});
