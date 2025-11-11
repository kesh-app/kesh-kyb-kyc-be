import { Inject, Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { Pool } from 'pg';

@Injectable()
export class ApplicationsService {
  constructor(@Inject('PG_POOL') private readonly pool: Pool) {}

  async createIndividual(dto: any, userId: number, branchId?: number) {
    const q = await this.pool.query(
      `INSERT INTO persons (full_name, identity_type, identity_number, address_identity, address_residential,
                            pob, dob, nationality, phone, occupation, gender, email, signature_uri)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING id`,
      [dto.full_name, dto.identity_type, dto.identity_number, dto.address_identity, dto.address_residential || null,
       dto.pob, dto.dob, dto.nationality, dto.phone, dto.occupation, dto.gender, dto.email || null, dto.signature_uri || null]
    );
    const personId = q.rows[0].id;

    const appRes = await this.pool.query(
      `INSERT INTO applications (type, status, branch_id, created_by, person_id)
       VALUES ('INDIVIDUAL','DRAFT',$1,$2,$3)
       RETURNING id, status`,
      [branchId || null, userId, personId]
    );
    return appRes.rows[0];
  }

  async createBusiness(dto: any, userId: number, branchId?: number) {
    const q = await this.pool.query(
      `INSERT INTO business_entities (legal_name, legal_form, incorporation_place, incorporation_date,
        business_license_number, nib, npwp, address_line, city, province, postal_code, business_activity, industry_code, phone)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING id`,
      [dto.legal_name, dto.legal_form, dto.incorporation_place, dto.incorporation_date,
       dto.business_license_number, dto.nib, dto.npwp, dto.address_line, dto.city, dto.province,
       dto.postal_code, dto.business_activity, dto.industry_code || null, dto.phone]
    );
    const businessId = q.rows[0].id;

    const appRes = await this.pool.query(
      `INSERT INTO applications (type, status, branch_id, created_by, business_id)
       VALUES ('BUSINESS','DRAFT',$1,$2,$3)
       RETURNING id, status`,
      [branchId || null, userId, businessId]
    );
    return appRes.rows[0];
  }

  async addDocument(appId: number, dto: { doc_type: string; file_uri: string; extracted_json?: any }) {
    const { rows: apps } = await this.pool.query(`SELECT id FROM applications WHERE id=$1`, [appId]);
    if (!apps[0]) throw new NotFoundException('Application not found');

    const res = await this.pool.query(
      `INSERT INTO documents (application_id, doc_type, file_uri, status, extracted_json)
       VALUES ($1,$2,$3,'PENDING',$4)
       RETURNING id, application_id, doc_type, file_uri, status, extracted_json, created_at`,
      [appId, dto.doc_type, dto.file_uri, dto.extracted_json || null]
    );
    return res.rows[0];
  }

  async submit(appId: number, reviewerId: number) {
    const res = await this.pool.query(
      `UPDATE applications
       SET status='SUBMITTED', submitted_at=now(), reviewer_id=$2
       WHERE id=$1
       RETURNING id, status`,
      [appId, reviewerId]
    );
    if (!res.rows[0]) throw new NotFoundException('Application not found');
    return res.rows[0];
  }

  async list(limit = 20, offset = 0) {
    const { rows } = await this.pool.query(
      `SELECT a.id, a.type, a.status, a.created_at,
              p.full_name as person_name, b.legal_name as business_name
       FROM applications a
       LEFT JOIN persons p ON p.id = a.person_id
       LEFT JOIN business_entities b ON b.id = a.business_id
       ORDER BY a.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return rows;
  }

  async listDocuments(appId: number) {
    const { rows: apps } = await this.pool.query(`SELECT id FROM applications WHERE id=$1`, [appId]);
    if (!apps[0]) throw new NotFoundException('Application not found');

    const { rows } = await this.pool.query(
      `SELECT id, doc_type, file_uri, status, extracted_json, created_at
       FROM documents
       WHERE application_id=$1
       ORDER BY created_at DESC`,
      [appId]
    );
    return rows;
  }

  async getDocument(appId: number, docId: number) {
    const { rows } = await this.pool.query(
      `SELECT id, application_id, doc_type, file_uri, status, extracted_json
       FROM documents
       WHERE id=$1`,
      [docId]
    );
    const doc = rows[0];
    if (!doc) throw new NotFoundException('Document not found');
    if (doc.application_id !== appId) throw new ForbiddenException('Document does not belong to this application');
    return doc;
  }

  async deleteDocument(appId: number, docId: number) {
    const doc = await this.getDocument(appId, docId);
    await this.pool.query(`DELETE FROM documents WHERE id=$1`, [docId]);
    return doc;
  }
}
