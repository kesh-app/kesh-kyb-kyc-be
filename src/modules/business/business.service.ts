import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Pool } from 'pg';

@Injectable()
export class BusinessService {
  constructor(@Inject('PG_POOL') private readonly pool: Pool) {}

  // "Lainnya" companion helper: *_other never replaces the dropdown value.
  private resolveOther(
    dto: any,
    main: string,
    other: string,
    label: string,
  ): string | null {
    const isLainnya =
      typeof dto[main] === 'string' &&
      dto[main].trim().toLowerCase() === 'lainnya';
    if (!isLainnya) return null;
    const v =
      typeof dto[other] === 'string' && dto[other].trim() === ''
        ? null
        : (dto[other] ?? null);
    if (v === null) {
      throw new BadRequestException(
        `Keterangan lainnya wajib diisi untuk ${label}.`,
      );
    }
    return v;
  }

  async ensureBusiness(businessId: number) {
    const { rows } = await this.pool.query('SELECT id FROM business_entities WHERE id=$1', [businessId]);
    if (!rows[0]) throw new NotFoundException('Business not found');
  }

  async createPerson(dto: any) {
    const q = await this.pool.query(
      `INSERT INTO persons (full_name, identity_type, identity_number, address_identity, pob, dob, nationality, phone, gender, occupation, email)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (identity_type, identity_number) DO UPDATE
         SET full_name = EXCLUDED.full_name
       RETURNING id`,
      [
        dto.full_name, dto.identity_type, dto.identity_number, dto.address_identity,
        dto.pob, dto.dob, dto.nationality, dto.phone, dto.gender,
        dto.occupation || null, dto.email || null,
      ]
    );
    return q.rows[0].id as number;
  }

  async addPartyWithNewPerson(businessId: number, dto: any) {
    await this.ensureBusiness(businessId);

    // B.2 Nomor Identitas Pengurus/BO/Pemegang Saham: maksimal 16 karakter.
    if (dto.identity_number && String(dto.identity_number).length > 16) {
      throw new BadRequestException('Nomor Identitas maksimal 16 karakter.');
    }

    // A. "Lainnya" companions (tidak menggantikan nilai dropdown).
    const sofOther = this.resolveOther(
      dto,
      'source_of_funds',
      'source_of_funds_other',
      'Sumber Dana',
    );
    const sowOther = this.resolveOther(
      dto,
      'source_of_wealth',
      'source_of_wealth_other',
      'Sumber Kekayaan',
    );

    const personId = await this.createPerson(dto);
    const res = await this.pool.query(
      `INSERT INTO business_parties (
         business_id, person_id, role,
         ownership_percentage, address, identity_document_type,
         source_of_funds, source_of_wealth, source_of_funds_other, source_of_wealth_other
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (business_id, person_id, role) DO UPDATE
         SET is_active = TRUE, updated_at=now(),
             ownership_percentage = COALESCE(EXCLUDED.ownership_percentage, business_parties.ownership_percentage),
             address = COALESCE(EXCLUDED.address, business_parties.address),
             identity_document_type = COALESCE(EXCLUDED.identity_document_type, business_parties.identity_document_type),
             source_of_funds = COALESCE(EXCLUDED.source_of_funds, business_parties.source_of_funds),
             source_of_wealth = COALESCE(EXCLUDED.source_of_wealth, business_parties.source_of_wealth),
             source_of_funds_other = EXCLUDED.source_of_funds_other,
             source_of_wealth_other = EXCLUDED.source_of_wealth_other
       RETURNING id, business_id, person_id, role, is_active, created_at,
                 ownership_percentage, address, identity_document_type,
                 source_of_funds, source_of_wealth, source_of_funds_other, source_of_wealth_other`,
      [
        businessId,
        personId,
        dto.role,
        dto.ownership_percentage ?? null,
        dto.address ?? null,
        dto.identity_document_type ?? null,
        dto.source_of_funds ?? null,
        dto.source_of_wealth ?? null,
        sofOther,
        sowOther,
      ]
    );
    return res.rows[0];
  }

  async linkExistingPerson(businessId: number, personId: number, role: string) {
    await this.ensureBusiness(businessId);
    const { rows: p } = await this.pool.query('SELECT id FROM persons WHERE id=$1', [personId]);
    if (!p[0]) throw new NotFoundException('Person not found');

    const res = await this.pool.query(
      `INSERT INTO business_parties (business_id, person_id, role)
       VALUES ($1,$2,$3)
       ON CONFLICT (business_id, person_id, role) DO UPDATE SET is_active = TRUE, updated_at=now()
       RETURNING id, business_id, person_id, role, is_active, created_at`,
      [businessId, personId, role]
    );
    return res.rows[0];
  }

  async listParties(businessId: number) {
    await this.ensureBusiness(businessId);
    const { rows } = await this.pool.query(
      `SELECT bp.id, bp.role, bp.is_active, bp.created_at,
              bp.ownership_percentage, bp.address,
              bp.identity_document_type,
              bp.source_of_funds, bp.source_of_funds_other,
              bp.source_of_wealth, bp.source_of_wealth_other,
              p.id as person_id, p.full_name, p.identity_type, p.identity_number, p.phone
       FROM business_parties bp
       JOIN persons p ON p.id = bp.person_id
       WHERE bp.business_id = $1
       ORDER BY bp.created_at DESC`,
      [businessId]
    );
    return rows;
  }

  async removeParty(businessId: number, partyId: number) {
    await this.ensureBusiness(businessId);
    const { rows } = await this.pool.query(
      `DELETE FROM business_parties WHERE id=$1 AND business_id=$2 RETURNING id`,
      [partyId, businessId]
    );
    if (!rows[0]) throw new NotFoundException('Party not found');
    return { ok: true };
  }
}
