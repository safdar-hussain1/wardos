/**
 * Deterministic name/description pools for the seed generator. Nothing in
 * this module is random — `seed.ts` draws from these arrays with the
 * seeded `mulberry32` PRNG (via `pick`/`randInt` from `../core/rng`), which
 * is what makes the generated history reproducible.
 *
 * Given-name and family-name pools each span multiple Indian linguistic
 * regions (Hindi belt, Punjabi, Bengali, Marathi, Gujarati, Tamil, Telugu,
 * Kannada, Malayalam), so the cross product is both realistic and far past
 * the ≥40 given+family combinations called for in the task brief.
 */

export const FEMALE_GIVEN_NAMES = [
  'Asha', 'Priya', 'Ananya', 'Divya', 'Kavya', 'Meera', 'Neha', 'Pooja',
  'Radha', 'Sneha', 'Anjali', 'Deepika', 'Isha', 'Lakshmi', 'Nandini',
  'Rekha', 'Shreya', 'Tanvi', 'Vidya', 'Yamini', 'Harpreet', 'Simran',
  'Mahima', 'Bhavna', 'Charulata',
] as const

export const MALE_GIVEN_NAMES = [
  'Arjun', 'Rohan', 'Vikram', 'Aditya', 'Karan', 'Rahul', 'Sanjay', 'Amit',
  'Deepak', 'Manoj', 'Nikhil', 'Praveen', 'Rajesh', 'Suresh', 'Vivek',
  'Anand', 'Gaurav', 'Harish', 'Imran', 'Jatin', 'Kiran', 'Manish',
  'Naveen', 'Om', 'Pankaj',
] as const

export const FAMILY_NAMES = [
  'Rao', 'Kumar', 'Sharma', 'Verma', 'Gupta', 'Reddy', 'Nair', 'Iyer',
  'Patel', 'Mehta', 'Singh', 'Chatterjee', 'Bose', 'Banerjee', 'Mukherjee',
  'Joshi', 'Deshmukh', 'Kulkarni', 'Naidu', 'Pillai', 'Menon', 'Das',
  'Chauhan', 'Bhatt', 'Trivedi',
] as const

export const DEPARTMENTS = [
  'General Medicine', 'Cardiology', 'Orthopedics', 'Pediatrics',
  'Intensive Care', 'Emergency Medicine', 'General Surgery', 'Neurology',
  'Nephrology', 'Gastroenterology', 'Obstetrics & Gynaecology', 'ENT',
  'Dermatology', 'Radiology', 'Anaesthesiology', 'Oncology', 'Urology',
  'Pulmonology', 'Physiotherapy', 'Administration', 'Transport',
  'Laboratory', 'Pharmacy',
] as const

export const DOCTOR_SPECIALTIES = [
  'Internal Medicine', 'Cardiology', 'Orthopedics', 'Pediatrics',
  'Critical Care', 'Emergency Medicine', 'General Surgery', 'Neurology',
  'Nephrology', 'Gastroenterology', 'Obstetrics & Gynaecology', 'ENT',
  'Dermatology', 'Anaesthesiology', 'Oncology', 'Pulmonology',
] as const

export const DIAGNOSES = [
  'Acute Appendicitis', 'Fracture — Tibia', 'Community Acquired Pneumonia',
  'Type 2 Diabetes Mellitus — Uncontrolled', 'Acute Gastroenteritis',
  'Hypertensive Emergency', 'Road Traffic Accident — Polytrauma',
  'Dengue Fever', 'Chronic Kidney Disease', 'Acute Cholecystitis',
  'Cataract — Elective Surgery', 'Normal Delivery', 'Caesarean Section',
  'Malaria', 'Typhoid Fever', 'Acute Myocardial Infarction',
  'Cerebrovascular Accident', 'COPD Exacerbation', 'Urinary Tract Infection',
  'Ureteric Colic — Kidney Stone', 'Inguinal Hernia Repair',
  'Chronic Tonsillitis', 'Cellulitis — Lower Limb', 'Asthma Exacerbation',
  'Severe Anaemia — Transfusion', 'Post-operative Observation',
  'Chikungunya', 'Viral Fever — Observation', 'Snake Bite — Observation',
  'Second-degree Burns', 'Fracture — Radius',
] as const

export const PROCEDURE_DESCRIPTIONS = [
  'Appendectomy', 'Open Reduction Internal Fixation', 'Cataract Surgery (Phaco)',
  'Caesarean Section', 'Laparoscopic Cholecystectomy', 'Hernia Repair',
  'Tonsillectomy', 'Coronary Angiography', 'Upper GI Endoscopy',
  'Dialysis Session', 'Wound Debridement', 'Blood Transfusion',
  'Physiotherapy Session', 'Chest X-Ray', 'CT Scan — Abdomen',
  'MRI — Brain', 'Ultrasound — Abdomen', 'ECG', 'Nebulisation Therapy',
] as const

export const PHARMACY_DESCRIPTIONS = [
  'IV Antibiotics Course', 'Analgesics', 'Insulin', 'Antihypertensives',
  'IV Fluids', 'Anti-emetics', 'Oral Antibiotics', 'Vitamin Supplements',
  'Anaesthesia Drugs', 'Anticoagulants', 'Antipyretics', 'Bronchodilators',
] as const

export const CONSULTATION_DESCRIPTIONS = [
  'Cardiology Consult', 'Orthopaedic Consult', 'Nephrology Consult',
  'ICU Consult', 'Physician Round', 'Surgical Consult', 'Paediatric Consult',
  'ENT Consult', 'Dermatology Consult', 'Follow-up Consult',
  'Anaesthesia Pre-op Consult',
] as const

export const TRANSPORT_DESCRIPTIONS = [
  'Ambulance Transfer to ICU', 'Inter-hospital Ambulance Transfer',
  'Wheelchair Transport', 'Stretcher Transport', 'Ambulance Standby Charge',
] as const

export const DISPATCH_LOCATIONS = [
  'MG Road', 'Koramangala', 'Andheri West', 'Banjara Hills',
  'Salt Lake City', 'Anna Nagar', 'Vasant Kunj', 'Civil Lines',
  'Sector 18', 'Gomti Nagar', 'Kothrud', 'Satellite', 'Vijay Nagar',
  'Jayanagar', 'T Nagar', 'Bandra', 'Whitefield', 'Indiranagar',
  'Rajouri Garden', 'Malviya Nagar',
] as const
