'use client';
import {useEffect,useRef,useState} from 'react';
import * as Select from '@radix-ui/react-select';
import {UiIcon} from '@/components/ui-icon';
import {brandPopupPosition,useBrandPopup} from '@/components/ui/use-brand-popup';

export type SelectOption={value:string;label:string;detail?:string;disabled?:boolean;group?:string};
type Props={id:string;name?:string;label?:string;value?:string;defaultValue?:string;onValueChange?:(value:string)=>void;options:SelectOption[];disabled?:boolean;required?:boolean;describedBy?:string;placeholder?:string};

// One shared primitive for customer and admin decisions. Radix owns keyboard,
// typeahead, touch selection, portal collision handling and focus restoration.
export function BrandSelect({id,name,label,value,defaultValue,onValueChange,options,disabled,required,describedBy,placeholder='Choose an option'}:Props) {
  const [open,setOpen]=useState(false);
  const [content,setContent]=useState<HTMLDivElement|null>(null);
  const trigger=useRef<HTMLButtonElement>(null);
  const popup=useBrandPopup(open,content,trigger);
  function changeOpen(next:boolean) {if(!next)popup.release();setOpen(next);}
  useEffect(()=>{if(disabled) setOpen(false);},[disabled]);
  const groups=[...new Set(options.map(option=>option.group||''))];
  // A browser's hidden form select can emit an empty change while dynamic
  // options remount. It is not a customer's choice and must not erase a visit.
  const change=(next:string)=>{if(!disabled&&options.some(option=>option.value===next&&!option.disabled)) onValueChange?.(next);};
  return <Select.Root name={name} value={value} defaultValue={defaultValue} onValueChange={change} disabled={disabled} required={required} open={open} onOpenChange={changeOpen}>
    <Select.Trigger ref={trigger} id={id} className="brand-select-trigger" aria-label={label} aria-describedby={describedBy} data-value={value}>
      <Select.Value placeholder={placeholder}/><Select.Icon className="brand-select-chevron" aria-hidden="true"><UiIcon name="chevron-down"/></Select.Icon>
    </Select.Trigger>
    <Select.Portal><Select.Content ref={setContent} className="brand-popup brand-select-menu" position="popper" {...brandPopupPosition} onCloseAutoFocus={popup.onCloseAutoFocus}>
      <div className="brand-select-scroll-slot" aria-hidden="true"><UiIcon name="chevron-up"/><Select.ScrollUpButton className="brand-select-scroll"><UiIcon name="chevron-up"/></Select.ScrollUpButton></div>
      <Select.Viewport className="brand-select-viewport" role="group" aria-label="Choices" tabIndex={0}>{groups.map(group=><Select.Group key={group}>
        {group&&<Select.Label className="brand-select-group">{group}</Select.Label>}
        {options.filter(option=>(option.group||'')===group).map(option=><Select.Item key={option.value} value={option.value} disabled={option.disabled} className="brand-select-item" textValue={option.label} data-value={option.value}>
          <span className="brand-select-option-copy"><Select.ItemText>{option.label}</Select.ItemText>{option.detail&&<span className="brand-select-detail">{option.detail}</span>}</span>
          <Select.ItemIndicator className="brand-select-check" aria-hidden="true"><UiIcon name="check"/></Select.ItemIndicator>
        </Select.Item>)}
      </Select.Group>)}</Select.Viewport>
      <div className="brand-select-scroll-slot" aria-hidden="true"><UiIcon name="chevron-down"/><Select.ScrollDownButton className="brand-select-scroll"><UiIcon name="chevron-down"/></Select.ScrollDownButton></div>
    </Select.Content></Select.Portal>
  </Select.Root>;
}
