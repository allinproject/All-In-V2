-- ALL-248 REVIEW ONLY. Apply after V2-KITCHEN-PANTRY-SHOPPING-OWNER-CANDIDATE.sql
-- in an ISOLATED transaction test, not the V2 hosted project.
-- Extend the SAME canonical Kitchen owner. A confirmed purchase receipt is
-- one transaction for ALL lines; "in_cart" is never a stock event.
alter table public.v2_kitchen_purchase_receipts
 add column payload jsonb not null;

create function public.v2_kitchen_confirm_purchase(
 p_expected_user_id uuid,
 p_receipt_id uuid,
 p_action_id uuid,
 p_lines jsonb
) returns uuid language plpgsql security definer set search_path=''
as $purchase$
declare
 v_user uuid:=auth.uid();
 v_existing public.v2_kitchen_purchase_receipts%rowtype;
 v_line jsonb;
 v_line_id uuid;
 v_lot_id uuid;
 v_food text;
 v_state text;
 v_unit text;
 v_location text;
 v_qty numeric;
 v_expiry date;
 v_expected_version bigint;
 v_lot public.v2_kitchen_pantry_lots%rowtype;
 v_line_ids uuid[]:='{}'::uuid[];
 v_lot_ids uuid[]:='{}'::uuid[];
begin
 if v_user is null or p_expected_user_id is distinct from v_user then
  raise exception 'Kitchen purchase owner mismatch' using errcode='42501';
 end if;
 if p_receipt_id is null or p_action_id is null or p_lines is null
  or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)<1
  or jsonb_array_length(p_lines)>100 then
  raise exception 'Purchase requires 1 to 100 reviewed lines' using errcode='22023';
 end if;
 -- Serialize receipt and lot operations for this owner. This is a review
 -- candidate; later reconcile locks with all Pantry consumption writers.
 perform pg_advisory_xact_lock(hashtextextended(v_user::text,248));
 select * into v_existing from public.v2_kitchen_purchase_receipts
 where user_id=v_user and client_action_id=p_action_id;
 if found then
  if v_existing.id is distinct from p_receipt_id
    or v_existing.payload is distinct from p_lines then
   raise exception 'Purchase action ID changed payload' using errcode='22000';
  end if;
  return v_existing.id;
 end if;
 -- Validate all lines before stock changes. Any error rolls back all lines.
 for v_line in select value from jsonb_array_elements(p_lines) loop
  if jsonb_typeof(v_line)<>'object'
    or (select count(*) from jsonb_object_keys(v_line))<>9
    or (select count(*) from jsonb_object_keys(v_line) k where
     k in ('lineId','lotId','foodId','preparationState','unit',
      'stockLocation','quantity','expectedLotVersion','expiryDate'))<>9 then
   raise exception 'Purchase line fields not reviewed' using errcode='22023';
  end if;
  begin
   v_line_id:=(v_line->>'lineId')::uuid;
   v_lot_id:=(v_line->>'lotId')::uuid;
   v_qty:=(v_line->>'quantity')::numeric;
   v_expected_version:=(v_line->>'expectedLotVersion')::bigint;
   v_expiry:=nullif(v_line->>'expiryDate','')::date;
  exception when invalid_text_representation or invalid_datetime_format
   or datetime_field_overflow or numeric_value_out_of_range then
   raise exception 'Malformed purchase identity, quantity or date' using errcode='22023';
  end;
  v_food:=v_line->>'foodId';
  v_state:=v_line->>'preparationState';
  v_unit:=v_line->>'unit';
  v_location:=v_line->>'stockLocation';
  if v_line_id is null or v_lot_id is null
   or v_line_id=any(v_line_ids) or v_lot_id=any(v_lot_ids)
   or v_food is null or length(btrim(v_food)) not between 1 and 160
   or v_food<>btrim(v_food)
   or v_state is null or length(btrim(v_state)) not between 1 and 80
   or v_unit is null or length(btrim(v_unit)) not between 1 and 40
   or v_location is null or v_location not in ('pantry','fridge','freezer','spices')
   or v_qty is null or v_qty<=0 or v_qty>1000000000
   or v_expected_version is null or v_expected_version<0 then
    raise exception 'Invalid reviewed purchase line' using errcode='22023';
  end if;
  v_line_ids:=array_append(v_line_ids,v_line_id);
  v_lot_ids:=array_append(v_lot_ids,v_lot_id);
 end loop;
 insert into public.v2_kitchen_purchase_receipts
  (user_id,id,client_action_id,payload)
 values(v_user,p_receipt_id,p_action_id,p_lines);
 for v_line in select value from jsonb_array_elements(p_lines) loop
  v_line_id:=(v_line->>'lineId')::uuid;
  v_lot_id:=(v_line->>'lotId')::uuid;
  v_qty:=(v_line->>'quantity')::numeric;
  v_expected_version:=(v_line->>'expectedLotVersion')::bigint;
  v_expiry:=nullif(v_line->>'expiryDate','')::date;
  v_food:=v_line->>'foodId';
  v_state:=v_line->>'preparationState';
  v_unit:=v_line->>'unit';
  v_location:=v_line->>'stockLocation';
  select * into v_lot from public.v2_kitchen_pantry_lots
   where user_id=v_user and id=v_lot_id for update;
  if found then
   if v_lot.version<>v_expected_version
    or v_lot.food_source_id is distinct from v_food
    or v_lot.preparation_state is distinct from v_state
    or v_lot.unit is distinct from v_unit
    or v_lot.stock_location is distinct from v_location
    or v_lot.expiry_date is distinct from v_expiry
    or v_lot.on_hand+v_qty>1000000000 then
    raise exception 'Pantry stock changed or source identity differs'
      using errcode='40001';
   end if;
   update public.v2_kitchen_pantry_lots
    set on_hand=on_hand+v_qty,version=version+1,updated_at=now()
    where user_id=v_user and id=v_lot_id;
  else
   if v_expected_version<>0 then
    raise exception 'Purchase targets missing Pantry lot' using errcode='40001';
   end if;
   insert into public.v2_kitchen_pantry_lots
    (user_id,id,food_source_id,preparation_state,unit,stock_location,
     on_hand,reserved,expiry_date,usable)
   values(v_user,v_lot_id,v_food,v_state,v_unit,v_location,v_qty,0,v_expiry,true);
  end if;
  insert into public.v2_kitchen_purchase_receipt_lines
   (user_id,receipt_id,line_id,food_source_id,preparation_state,unit,
    purchased_quantity,pantry_lot_id)
  values(v_user,p_receipt_id,v_line_id,v_food,v_state,v_unit,v_qty,v_lot_id);
 end loop;
 return p_receipt_id;
end;
$purchase$;
revoke all on function public.v2_kitchen_confirm_purchase(uuid,uuid,uuid,jsonb)
 from public,anon,authenticated,service_role;
grant execute on function public.v2_kitchen_confirm_purchase(uuid,uuid,uuid,jsonb)
 to authenticated;

-- RELEASE GATES: approved canonical food identity/FKs, source/provenance
-- attestation, exact purchase quantity and receipt review, all other Pantry
-- consumption writers on compatible locking, one live transaction owner,
-- ALL-251 export/deletion coverage and two-account hosted replay.
