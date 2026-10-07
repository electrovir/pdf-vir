import {assertWrap} from '@augment-vir/assert';
import {
    mapObjectValues,
    mergeDefinedProperties,
    type PartialWithUndefined,
} from '@augment-vir/common';
import {
    css,
    defineElement,
    defineElementEvent,
    html,
    listen,
    nothing,
    onDomCreated,
} from 'element-vir';
import {
    noUserSelect,
    ViraButton,
    ViraCheckbox,
    ViraColorVariant,
    ViraDropdown,
    ViraEmphasis,
    ViraIcon,
    viraShadows,
    viraTheme,
} from 'vira';
import {pdfVirIcons} from './icons.js';
import {
    getPdfFormAssigneeColor,
    resolvePdfFormAssigneeColors,
    type PdfFormAssignee,
} from './pdf-form-assignee.js';
import {pdfFormCssVars} from './pdf-form-css-vars.js';
import {
    movePdfFormFieldBox,
    pdfFormFieldConfig,
    resizePdfFormFieldBox,
    type PdfFormField,
    type PdfFormFieldBox,
} from './pdf-form-field.js';

/**
 * What a pointer pressed on a {@link PdfVirFormField} is doing.
 *
 * @category Internal
 */
export enum PdfFormFieldGesture {
    Move = 'move',
    Resize = 'resize',
}

/** The smallest a field can be resized to, in CSS pixels at the current zoom. */
const minFieldSizePx = 12;

/**
 * Below this `y` fraction there isn't room above the field for its toolbar, which would then be
 * clipped by the top of the viewer, so the toolbar goes below the field instead.
 */
const toolbarFlipThreshold = 0.05;

/** `ViraDropdown` option values must be strings, so this stands in for an unset `assigneeId`. */
const everyoneOptionValue = '';

/**
 * Every piece of text {@link PdfVirFormField} renders.
 *
 * @category Internal
 */
export type PdfVirFormFieldI18n = typeof defaultPdfVirFormFieldI18n;

/**
 * The text {@link PdfVirFormField} renders when its `text` input leaves an entry out.
 *
 * @category Internal
 */
export const defaultPdfVirFormFieldI18n = {
    required: 'Required?',
    delete: 'Delete',
    /** Shown in the assignee dropdown of a field whose assignee is not in the `assignees` list. */
    assigneePlaceholder: 'Assignee',
    /** The assignee option for a field assigned to no one, which anyone can fill. */
    everyone: 'Everyone',
    /** The name each palette block is drawn with, and the title of each placed field. */
    fieldTypeLabels: mapObjectValues(pdfFormFieldConfig, (type, config) => {
        return config.label;
    }),
};

/**
 * One draggable, resizable field on a page, as drawn by `PdfVirFormEditor`. Must be rendered
 * directly inside a positioned layer that exactly covers the page, since it positions itself and
 * measures drags against its parent element.
 *
 * Controlled: dragging, resizing, and toggling "Required?" only emit `fieldChange`. Nothing moves
 * until the new field is passed back in.
 *
 * @category Internal
 */
export const PdfVirFormField = defineElement<
    {
        field: Readonly<PdfFormField>;
        isSelected: boolean;
    } & PartialWithUndefined<{
        /**
         * Colors the field by its assignee and adds an assignee dropdown to its toolbar. Omit or
         * leave empty to draw every field in the default colors with no dropdown.
         */
        assignees: ReadonlyArray<Readonly<PdfFormAssignee>>;
        i18n: Readonly<PartialWithUndefined<PdfVirFormFieldI18n>>;
    }>
>()({
    tagName: 'pdf-vir-form-field',
    hostClasses: {
        'pdf-vir-form-field-selected'({inputs}) {
            return inputs.isSelected;
        },
        'pdf-vir-form-field-required'({inputs}) {
            return inputs.field.isRequired;
        },
        'pdf-vir-form-field-alt-pressed'({state}) {
            return state.isAltPressed;
        },
    },
    styles({hostClasses}) {
        return css`
            :host {
                position: absolute;
                box-sizing: border-box;
                display: flex;
                border: 1px solid
                    color-mix(
                        in srgb,
                        ${pdfFormCssVars['pdf-vir-field-accent-color'].value} 60%,
                        transparent
                    );
                background-color: color-mix(
                    in srgb,
                    ${pdfFormCssVars['pdf-vir-field-accent-color'].value} 12%,
                    transparent
                );
                color: ${pdfFormCssVars['pdf-vir-field-text-color'].value};
                cursor: move;
                /* Stops a touch drag from scrolling the viewer instead of moving the field. */
                touch-action: none;
                ${noUserSelect}
            }

            ${hostClasses['pdf-vir-form-field-selected'].selector} {
                z-index: 1;
                border: 2px solid ${pdfFormCssVars['pdf-vir-field-accent-color'].value};
                background-color: color-mix(
                    in srgb,
                    ${pdfFormCssVars['pdf-vir-field-accent-color'].value} 20%,
                    transparent
                );
            }

            ${hostClasses['pdf-vir-form-field-required'].selector} {
                border-style: dashed;
                border-color: ${pdfFormCssVars['pdf-vir-red-accent-color'].value};
            }

            ${hostClasses['pdf-vir-form-field-alt-pressed'].selector} {
                cursor: copy;
            }

            .field {
                display: flex;
                justify-content: center;
                align-items: center;
                width: 100%;
                height: 100%;
                anchor-name: --pdf-vir-form-field;
                /* The selected border already marks the focused field. */
                outline: none;
            }

            .icon-wrapper {
                position: relative;
                display: flex;
                height: min(24px, 80%);
                aspect-ratio: 1;
            }

            .icon-wrapper ${ViraIcon} {
                width: 100%;
                height: 100%;
            }

            .required-marker {
                position: absolute;
                top: -0.5em;
                right: -0.6em;
                color: ${pdfFormCssVars['pdf-vir-red-accent-color'].value};
                font-weight: bold;
                font-size: 14px;
            }

            .toolbar {
                /*
                 * The toolbar is a popover so it lives in the top layer: a toolbar wider than the
                 * field no longer counts as page overflow, which would otherwise give the viewer a
                 * horizontal scrollbar.
                 */
                position: fixed;
                position-anchor: --pdf-vir-form-field;
                position-area: top span-right;
                /* Undo the popover UA styles that would center it in the viewport. */
                inset: auto;
                margin: 0 0 6px;
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 4px 8px;
                box-sizing: border-box;
                background-color: ${viraTheme.colors['theme-default'].background.value};
                color: ${viraTheme.colors['theme-default'].foreground.value};
                border: 1px solid
                    ${viraTheme.colors['vira-grey-behind-bg-decoration'].background.value};
                border-radius: 6px;
                ${viraShadows.menuShadow}
                white-space: nowrap;
                cursor: default;
                font-size: 14px;

                &.below {
                    position-area: bottom span-right;
                    margin: 6px 0 0;
                }
            }

            .resize-handle {
                position: absolute;
                right: -6px;
                bottom: -6px;
                width: 10px;
                height: 10px;
                border: 1px solid ${pdfFormCssVars['pdf-vir-page-background-color'].value};
                border-radius: 2px;
                background-color: ${pdfFormCssVars['pdf-vir-field-accent-color'].value};
                cursor: nwse-resize;
            }
        `;
    },
    events: {
        fieldChange: defineElementEvent<PdfFormField>(),
        fieldSelect: defineElementEvent<void>(),
        fieldDelete: defineElementEvent<void>(),
        /**
         * Emitted in place of `fieldChange` on the first move of an Alt (Option) drag. The detail
         * is this field moved, and a copy of the field with a new id should be added where it was.
         */
        fieldDuplicate: defineElementEvent<PdfFormField>(),
    },
    state() {
        return {
            /** Shows that an Alt (Option) drag duplicates the field. */
            isAltPressed: false,
            keyListeners: {
                current: undefined as undefined | AbortController,
            },
            gesture: {
                current: undefined as
                    | undefined
                    | {
                          type: PdfFormFieldGesture;
                          pointerId: number;
                          startX: number;
                          startY: number;
                          startBox: PdfFormFieldBox;
                          pageWidthPx: number;
                          pageHeightPx: number;
                          isDuplicating: boolean;
                      },
            },
        };
    },
    init({state, updateState}) {
        const abortController = new AbortController();
        state.keyListeners.current = abortController;

        function updateAltPressed(event: Readonly<KeyboardEvent>) {
            updateState({
                isAltPressed: event.altKey,
            });
        }

        globalThis.addEventListener('keydown', updateAltPressed, {
            signal: abortController.signal,
        });
        globalThis.addEventListener('keyup', updateAltPressed, {
            signal: abortController.signal,
        });
        /* A key released while the window is in the background never sends its `keyup`. */
        globalThis.addEventListener(
            'blur',
            () => {
                updateState({
                    isAltPressed: false,
                });
            },
            {
                signal: abortController.signal,
            },
        );
    },
    cleanup({state}) {
        state.keyListeners.current?.abort();
    },
    render({inputs, state, host, updateState, dispatch, events}) {
        const i18n = mergeDefinedProperties(defaultPdfVirFormFieldI18n, inputs.i18n);
        const resolvedAssigneeColors = resolvePdfFormAssigneeColors(inputs.assignees || []);

        function startGesture(type: PdfFormFieldGesture, event: PointerEvent) {
            if (event.button !== 0) {
                return;
            }
            event.preventDefault();
            /* Keeps the resize handle's press from also starting a move. */
            event.stopPropagation();

            const pageRect = assertWrap.isDefined(host.parentElement).getBoundingClientRect();
            const target = assertWrap.instanceOf(event.currentTarget, Element);
            target.setPointerCapture(event.pointerId);
            /* Canceling the press above also cancels the focus that Delete and Backspace need. */
            assertWrap.instanceOf(target.closest('.field'), HTMLElement).focus({
                preventScroll: true,
            });
            state.gesture.current = {
                type,
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                startBox: {
                    x: inputs.field.x,
                    y: inputs.field.y,
                    width: inputs.field.width,
                    height: inputs.field.height,
                },
                pageWidthPx: pageRect.width,
                pageHeightPx: pageRect.height,
                isDuplicating: type === PdfFormFieldGesture.Move && event.altKey,
            };

            if (!inputs.isSelected) {
                dispatch(
                    new events.fieldSelect({
                        detail: undefined,
                    }),
                );
            }
        }

        function updateGesture(event: PointerEvent) {
            const gesture = state.gesture.current;
            if (!gesture || gesture.pointerId !== event.pointerId || !gesture.pageWidthPx) {
                return;
            }
            const deltaX = (event.clientX - gesture.startX) / gesture.pageWidthPx;
            const deltaY = (event.clientY - gesture.startY) / gesture.pageHeightPx;

            const gestureHandlers: Record<PdfFormFieldGesture, () => PdfFormFieldBox> = {
                [PdfFormFieldGesture.Move]() {
                    return movePdfFormFieldBox({
                        box: gesture.startBox,
                        deltaX,
                        deltaY,
                    });
                },
                [PdfFormFieldGesture.Resize]() {
                    return resizePdfFormFieldBox({
                        box: gesture.startBox,
                        deltaWidth: deltaX,
                        deltaHeight: deltaY,
                        minWidth: minFieldSizePx / gesture.pageWidthPx,
                        minHeight: minFieldSizePx / gesture.pageHeightPx,
                    });
                },
            };

            const newField = {
                ...inputs.field,
                ...gestureHandlers[gesture.type](),
            };

            if (gesture.isDuplicating) {
                gesture.isDuplicating = false;
                dispatch(
                    new events.fieldDuplicate({
                        detail: newField,
                    }),
                );
            } else {
                dispatch(
                    new events.fieldChange({
                        detail: newField,
                    }),
                );
            }
        }

        function endGesture(event: PointerEvent) {
            if (state.gesture.current?.pointerId === event.pointerId) {
                state.gesture.current = undefined;
            }
        }

        host.style.left = `${inputs.field.x * 100}%`;
        host.style.top = `${inputs.field.y * 100}%`;
        host.style.width = `${inputs.field.width * 100}%`;
        host.style.height = `${inputs.field.height * 100}%`;

        if (inputs.assignees?.length) {
            const color = getPdfFormAssigneeColor({
                assignees: inputs.assignees,
                assigneeId: inputs.field.assigneeId,
            });
            host.style.setProperty(
                pdfFormCssVars['pdf-vir-field-accent-color'].name.cssText,
                color.accent.cssText,
            );
            host.style.setProperty(
                pdfFormCssVars['pdf-vir-field-text-color'].name.cssText,
                color.text.cssText,
            );
        } else {
            host.style.removeProperty(pdfFormCssVars['pdf-vir-field-accent-color'].name.cssText);
            host.style.removeProperty(pdfFormCssVars['pdf-vir-field-text-color'].name.cssText);
        }

        return html`
            <div
                class="field"
                tabindex="0"
                ${listen('focus', () => {
                    if (!inputs.isSelected) {
                        dispatch(
                            new events.fieldSelect({
                                detail: undefined,
                            }),
                        );
                    }
                })}
                ${listen('keydown', (event) => {
                    /* Keys pressed inside the toolbar's controls are theirs. */
                    if (
                        event.target === event.currentTarget &&
                        (event.key === 'Delete' || event.key === 'Backspace')
                    ) {
                        event.preventDefault();
                        dispatch(
                            new events.fieldDelete({
                                detail: undefined,
                            }),
                        );
                    }
                })}
                ${listen('pointerdown', (event) => {
                    startGesture(PdfFormFieldGesture.Move, event);
                })}
                ${listen('pointermove', (event) => {
                    if (event.altKey !== state.isAltPressed) {
                        updateState({
                            isAltPressed: event.altKey,
                        });
                    }
                    updateGesture(event);
                })}
                ${listen('pointerup', endGesture)}
                ${listen('pointercancel', endGesture)}
                ${listen('click', (event) => {
                    /* Clicks on the page around the field deselect it; clicks on the field must not. */
                    event.stopPropagation();
                })}
            >
                <div class="icon-wrapper" title=${i18n.fieldTypeLabels[inputs.field.type]}>
                    <${ViraIcon.assign({
                        icon: pdfFormFieldConfig[inputs.field.type].icon,
                        fitContainer: true,
                    })}></${ViraIcon}>
                    ${inputs.field.isRequired
                        ? html`
                              <span class="required-marker">*</span>
                          `
                        : nothing}
                </div>
                ${inputs.isSelected
                    ? html`
                          <div
                              class="toolbar ${inputs.field.y < toolbarFlipThreshold
                                  ? 'below'
                                  : ''}"
                              popover="manual"
                              ${onDomCreated((element) => {
                                  assertWrap.instanceOf(element, HTMLElement).showPopover();
                              })}
                              ${listen('pointerdown', (event) => {
                                  event.stopPropagation();
                              })}
                          >
                              <${ViraButton.assign({
                                  icon: pdfVirIcons.trash,
                                  buttonEmphasis: ViraEmphasis.Subtle,
                                  color: ViraColorVariant.Danger,
                              })}
                                  title=${i18n.delete}
                                  ${listen('click', () => {
                                      dispatch(
                                          new events.fieldDelete({
                                              detail: undefined,
                                          }),
                                      );
                                  })}
                              ></${ViraButton}>
                              ${inputs.assignees?.length
                                  ? html`
                                        <${ViraDropdown.assign({
                                            options: [
                                                {
                                                    value: everyoneOptionValue,
                                                    label: i18n.everyone,
                                                    labelTemplate: html`
                                                        <span
                                                            style=${css`
                                                                color: ${viraTheme.colors[
                                                                    'vira-grey-foreground-placeholder'
                                                                ].foreground.value};
                                                            `}
                                                        >
                                                            ${i18n.everyone}
                                                        </span>
                                                    `,
                                                    icon: pdfVirIcons.everyoneDot,
                                                },
                                                ...inputs.assignees.map((assignee, index) => {
                                                    return {
                                                        value: assignee.id,
                                                        label: assignee.label,
                                                        icon: pdfVirIcons.assigneeDots[
                                                            assertWrap.isDefined(
                                                                resolvedAssigneeColors[index],
                                                            )
                                                        ],
                                                    };
                                                }),
                                            ],
                                            selected: [
                                                inputs.field.assigneeId || everyoneOptionValue,
                                            ],
                                            placeholder: i18n.assigneePlaceholder,
                                        })}
                                            ${listen(
                                                ViraDropdown.events.selectedValuesChange,
                                                (event) => {
                                                    dispatch(
                                                        new events.fieldChange({
                                                            detail: {
                                                                ...inputs.field,
                                                                assigneeId:
                                                                    event.detail[0] || undefined,
                                                            },
                                                        }),
                                                    );
                                                },
                                            )}
                                        ></${ViraDropdown}>
                                    `
                                  : nothing}
                              <${ViraCheckbox.assign({
                                  value: inputs.field.isRequired,
                                  label: i18n.required,
                                  useHorizontalLabel: true,
                              })}
                                  ${listen(ViraCheckbox.events.valueChange, (event) => {
                                      dispatch(
                                          new events.fieldChange({
                                              detail: {
                                                  ...inputs.field,
                                                  isRequired: event.detail,
                                              },
                                          }),
                                      );
                                  })}
                              ></${ViraCheckbox}>
                          </div>
                          <div
                              class="resize-handle"
                              ${listen('pointerdown', (event) => {
                                  startGesture(PdfFormFieldGesture.Resize, event);
                              })}
                          ></div>
                      `
                    : nothing}
            </div>
        `;
    },
});
